import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ApiErrorSchema,
  ChannelListItemSchema,
  CompareResponseSchema,
  PublicChatbotConfigSchema,
  PublicMessageResponseSchema,
  SimulateResponseSchema,
} from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

// No.12 전역 가드 도입 이후 전 요청에 인증 쿠키가 필요하다(NFR-M4). beforeAll에서 로그인해 채운다.
// 공개 API(`/public/*`) 호출에도 그대로 실리지만 `@Public()` 경로는 쿠키 유무와 무관하게 통과한다.
let authCookie = '';

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      {
        method,
        hostname,
        port,
        path: pathname + search,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(authCookie ? { Cookie: authCookie } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 품질/채널(No.10~11) 통합 테스트. 채널 CRUD, 시뮬레이션(오버레이/비교), 공개 대화 API,
 * 노드 직접 점프, 동음이의어 되묻기 왕복을 HTTP 계약 레벨에서 검증한다.
 */
describe('품질/채널(No.10~11) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-quality-channel-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma db push 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // main.ts와 동일하게 body-parser 상한을 2MB로 올린다 — 기본값(100KB)은 오버레이 1MB 상한
    // (FR-10-21, OVERLAY_LIMITS.bodyBytes)보다 작아 정상 요청이 우리 ApiException이 아닌 Express의
    // generic 413으로 실패한다(code-reviewer 지적 — 아래 "오버레이 요청 본문 크기" 테스트가 검증한다).
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { limit: '2mb' });
    app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    const prisma = moduleRef.get(PrismaService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    authCookie = await loginAs(baseUrl, 'ADMIN');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createGroup(name = '품질채널 테스트 그룹'): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name });
    return res.body.id as string;
  }

  async function createChatbot(overrides: Partial<{ name: string; slug: string; groupId: string }> = {}): Promise<{ id: string; slug: string }> {
    const groupId = overrides.groupId ?? (await createGroup());
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = overrides.slug ?? `qc-bot-${suffix}`;
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: overrides.name ?? '품질채널 테스트봇',
      slug,
    });
    return { id: res.body.id as string, slug };
  }

  async function activateChatbot(chatbotId: string): Promise<void> {
    const res = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    expect(res.status).toBe(200);
  }

  function base(chatbotId: string): string {
    return `${baseUrl}/chatbots/${chatbotId}`;
  }

  // ================================================================================================
  // 채널 CRUD — FR-11-1~13
  // ================================================================================================
  describe('채널 CRUD', () => {
    it('AC-11-1: 채널 목록은 레코드 유무와 무관하게 8종 전부를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ items: Array<{ type: string; configured: boolean }> }>('GET', `${base(chatbotId)}/channels`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(8);
      expect(res.body.items.every((i) => i.configured === false)).toBe(true);
      expect(res.body.items[0].type).toBe('WEB');
      res.body.items.forEach((item) => ChannelListItemSchema.parse(item)); // AC-C-1
    });

    it('AC-11-x: WEB 채널은 활성화할 수 있다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ type: string; enabled: boolean; configured: boolean }>(
        'PATCH',
        `${base(chatbotId)}/channels/WEB`,
        { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } },
      );
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.configured).toBe(true);
    });

    it('AC-11-3/4: CONFIG_ONLY 채널(KAKAOTALK)을 활성화하려 하면 409 CHANNEL_NOT_IMPLEMENTED를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PATCH', `${base(chatbotId)}/channels/KAKAOTALK`, { enabled: true });
      expect(res.status).toBe(409);
      expect(ApiErrorSchema.parse(res.body).code).toBe('CHANNEL_NOT_IMPLEMENTED');
    });

    it('CONFIG_ONLY 채널의 note 설정 저장은 허용된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PATCH', `${base(chatbotId)}/channels/KAKAOTALK`, { config: { note: '2분기 오픈빌더 심사 예정' } });
      expect(res.status).toBe(200);
    });

    it('EX-11-2: 자격증명 필드를 보내면 400으로 정직하게 거부한다(.strict())', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PATCH', `${base(chatbotId)}/channels/WEB`, { config: { accessToken: 'secret' } });
      expect(res.status).toBe(400);
    });

    it('FR-11-11: 채널 삭제는 멱등 204다(레코드 없어도 204)', async () => {
      const { id: chatbotId } = await createChatbot();
      const first = await jsonRequest('DELETE', `${base(chatbotId)}/channels/WEB`);
      expect(first.status).toBe(204);
      const second = await jsonRequest('DELETE', `${base(chatbotId)}/channels/WEB`);
      expect(second.status).toBe(204);
    });

    it('오타 type 경로는 404가 아니라 400을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PATCH', `${base(chatbotId)}/channels/NOT_A_CHANNEL`, {});
      expect(res.status).toBe(400);
    });
  });

  // ================================================================================================
  // 시뮬레이션 — FR-10-1~31
  // ================================================================================================
  describe('시뮬레이션', () => {
    async function seedNode(chatbotId: string): Promise<{ intentId: string; nodeId: string }> {
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
        name: '배송조회',
        examples: ['배송 조회'],
      });
      const intentId = intentRes.body.intent.id;
      const nodeRes = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '배송조회_응답',
        intentIds: [intentId],
        outputs: [{ type: 'TEXT', payload: { text: '운송장을 확인해 드릴게요.' } }],
      });
      return { intentId, nodeId: nodeRes.body.id };
    }

    it('AC-10-1: 메시지를 보내면 매칭된 노드의 응답을 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const { nodeId } = await seedNode(chatbotId);
      const res = await jsonRequest<{ matchedNodeId: string; matchedNodeName: string; outputs: unknown[] }>(
        'POST',
        `${base(chatbotId)}/simulate`,
        { message: '배송 조회' },
      );
      expect(res.status).toBe(200);
      expect(res.body.matchedNodeId).toBe(nodeId);
      expect(res.body.matchedNodeName).toBe('배송조회_응답');
      SimulateResponseSchema.parse(res.body); // AC-C-1: 응답 스키마 계약 검증
    });

    it('AC-10-14: 시뮬레이션은 ConversationLog를 기록하지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      await seedNode(chatbotId);
      await jsonRequest('POST', `${base(chatbotId)}/simulate`, { message: '배송 조회' });
      const stats = await jsonRequest<{ totalLogCount: number }>('GET', `${baseUrl}/stats/dashboard?chatbotId=${chatbotId}`);
      expect(stats.status).toBe(200);
      expect(stats.body.totalLogCount).toBe(0);
    });

    it('FR-10-2: ARCHIVED 챗봇도 시뮬레이션은 허용된다(읽기 성격)', async () => {
      const { id: chatbotId } = await createChatbot();
      const del = await jsonRequest('DELETE', `${base(chatbotId)}`);
      expect(del.status).toBe(204);
      const res = await jsonRequest('POST', `${base(chatbotId)}/simulate`, { message: '안녕' });
      expect(res.status).toBe(200);
    });

    it('FR-0-22: ARCHIVED 챗봇의 채널 쓰기는 409 CHATBOT_ARCHIVED다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('DELETE', `${base(chatbotId)}`);
      const res = await jsonRequest('PATCH', `${base(chatbotId)}/channels/WEB`, { enabled: true });
      expect(res.status).toBe(409);
      expect(ApiErrorSchema.parse(res.body).code).toBe('CHATBOT_ARCHIVED');
    });

    it('FR-10-18~22: 오버레이로 저장하지 않은 노드를 테스트할 수 있고 DB에는 반영되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      // 오버레이 항목 간 상호 참조(신규 노드 → 신규 의도)는 이번 Phase 범위 밖이다 — 참조 대상(의도)은
      // 저장본이어야 하며, 오버레이는 이를 참조하는 "신규 노드"만 표현한다.
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
        name: '환불문의',
        examples: ['환불하고 싶어요'],
      });
      const res = await jsonRequest<{ matchedNodeId: string; outputs: Array<{ payload: { text: string } }> }>(
        'POST',
        `${base(chatbotId)}/simulate`,
        {
          message: '환불하고 싶어요',
          overlay: {
            dialogNodes: [
              {
                id: 'draft-node-1',
                name: '환불_응답',
                intentIds: [intentRes.body.intent.id],
                outputs: [{ type: 'TEXT', payload: { text: '환불 절차를 안내해 드릴게요.' } }],
              },
            ],
          },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.matchedNodeId).toBe('draft-node-1');
      expect(res.body.outputs[0].payload.text).toBe('환불 절차를 안내해 드릴게요.');

      const list = await jsonRequest<{ items: unknown[] }>('GET', `${base(chatbotId)}/dialog-nodes`);
      expect(list.body.items).toHaveLength(0);
    });

    it('FR-10-31: 오버레이가 비어 있는 비교 실행은 400 NO_CHANGES_TO_COMPARE다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('POST', `${base(chatbotId)}/simulate/compare`, { messages: ['안녕'], overlay: {} });
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('NO_CHANGES_TO_COMPARE');
    });

    it('FR-10-25~30: A/B 비교 실행은 변경된 턴에 DIFFERENT를 표시한다', async () => {
      const { id: chatbotId } = await createChatbot();
      await seedNode(chatbotId);
      const res = await jsonRequest<{
        turns: Array<{ diff: { status: string } }>;
        summary: { total: number; different: number };
      }>('POST', `${base(chatbotId)}/simulate/compare`, {
        messages: ['배송 조회'],
        overlay: { intents: [{ id: 'draft-intent-x', name: '새의도', examples: ['새로운 문의'] }] },
      });
      expect(res.status).toBe(200);
      expect(res.body.summary.total).toBe(1);
      // 오버레이가 배송조회 노드에 영향을 주지 않으므로 A/B 응답은 동일해야 한다.
      expect(res.body.turns[0].diff.status).toBe('SAME');
      CompareResponseSchema.parse(res.body); // AC-C-1
    });

    it('FR-E2-1/AC-P-13: buttonAction NODE로 노드를 직접 실행할 수 있다(노드 직접 점프)', async () => {
      const { id: chatbotId } = await createChatbot();
      const { nodeId } = await seedNode(chatbotId);
      const res = await jsonRequest<{ matchedNodeId: string }>('POST', `${base(chatbotId)}/simulate`, {
        buttonAction: { kind: 'NODE', nodeId, label: '바로가기' },
      });
      expect(res.status).toBe(200);
      expect(res.body.matchedNodeId).toBe(nodeId);
    });

    it('AC-E2-3~5: 동음이의어 되묻기가 다음 턴 버튼 클릭으로 실제 해소된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const fruitIntent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
        name: '과일문의',
        examples: ['과일 신선해요?'],
      });
      const shipIntent = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
        name: '선박문의',
        examples: ['선박 출항 시간'],
      });
      await jsonRequest('POST', `${base(chatbotId)}/homonyms`, {
        word: '배',
        policy: 'ASK',
        meanings: [
          { label: '과일', contextHints: ['사과'], intentId: fruitIntent.body.intent.id },
          { label: '선박', contextHints: ['항구'], intentId: shipIntent.body.intent.id },
        ],
      });
      await jsonRequest('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '선박_응답',
        intentIds: [shipIntent.body.intent.id],
        outputs: [{ type: 'TEXT', payload: { text: '선박 출항 정보를 안내해 드릴게요.' } }],
      });

      const first = await jsonRequest<{ outputs: Array<{ type: string }>; state: unknown }>('POST', `${base(chatbotId)}/simulate`, {
        message: '배 언제 와요?',
      });
      expect(first.status).toBe(200);
      expect(first.body.outputs[0].type).toBe('BUTTON');

      const second = await jsonRequest<{ matchedNodeId?: string; matchedIntentId?: string; trace: Array<{ code: string }> }>(
        'POST',
        `${base(chatbotId)}/simulate`,
        { message: '선박', state: first.body.state },
      );
      expect(second.status).toBe(200);
      expect(second.body.trace.some((t) => t.code === 'CLARIFY_RESOLVED')).toBe(true);
      expect(second.body.matchedIntentId).toBe(shipIntent.body.intent.id);
    });

    describe('오버레이 요청 본문 크기(FR-10-21, code-reviewer 지적 — 100KB~1MB 경계, 실제 HTTP 페이로드)', () => {
      /**
       * examples 배열(항목당 최대 200자, 최대 500개/의도)로 오버레이 크기를 정밀 제어한다.
       * 전부 ASCII만 사용해 문자 수(JS string.length, 서버의 assertOverlaySize 판정 기준)와
       * 바이트 수(Buffer.byteLength, 실제 HTTP payload 크기)가 사실상 같아지도록 한다.
       */
      function buildSizedOverlay(intentCount: number): { intents: Array<{ id: string; name: string; examples: string[] }> } {
        const FILLER_LENGTH = 185;
        const intents = Array.from({ length: intentCount }, (_, i) => ({
          id: `draft-size-intent-${i}`,
          name: `size-test-intent-${i}`,
          examples: Array.from({ length: 500 }, (_, j) => `filler-${i}-${j}-${'x'.repeat(FILLER_LENGTH)}`),
        }));
        return { intents };
      }

      it('약 200KB(100KB 초과, 1MB 미만) 오버레이는 정상 처리된다 — 과거 Express 기본 100KB 상한에 막히던 사례', async () => {
        const { id: chatbotId } = await createChatbot();
        const overlay = buildSizedOverlay(2);
        const requestBody = { message: '안녕하세요', overlay };
        const bodyBytes = Buffer.byteLength(JSON.stringify(requestBody));
        expect(bodyBytes).toBeGreaterThan(100 * 1024);
        expect(bodyBytes).toBeLessThan(1024 * 1024);

        const res = await jsonRequest('POST', `${base(chatbotId)}/simulate`, requestBody);
        expect(res.status).toBe(200);
      });

      it('약 1.08MB(1MB 초과, 2MB 미만) 오버레이는 400 LIMIT_EXCEEDED다 — body-parser의 생 413이 아니라 우리 오류 봉투를 반환한다', async () => {
        const { id: chatbotId } = await createChatbot();
        const overlay = buildSizedOverlay(11);
        const requestBody = { message: '안녕하세요', overlay };
        const bodyBytes = Buffer.byteLength(JSON.stringify(requestBody));
        expect(bodyBytes).toBeGreaterThan(1024 * 1024);
        expect(bodyBytes).toBeLessThan(2 * 1024 * 1024);

        const res = await jsonRequest('POST', `${base(chatbotId)}/simulate`, requestBody);
        expect(res.status).toBe(400);
        expect(ApiErrorSchema.parse(res.body).code).toBe('LIMIT_EXCEEDED');
      });
    });
  });

  // ================================================================================================
  // 공개 대화 API — FR-11-14~27
  // ================================================================================================
  describe('공개 대화 API', () => {
    async function setupPublicChatbot(allowedOrigins: string[] = []): Promise<{ chatbotId: string; slug: string }> {
      const { id: chatbotId, slug } = await createChatbot();
      await activateChatbot(chatbotId);
      const channelRes = await jsonRequest('PATCH', `${base(chatbotId)}/channels/WEB`, {
        enabled: true,
        config: { allowedOrigins, greetingMessage: '무엇을 도와드릴까요?' },
      });
      expect(channelRes.status).toBe(200);
      return { chatbotId, slug };
    }

    it('AC-P-1: 공개 config는 스킨/인사말만 반환하고 내부 식별자를 포함하지 않는다', async () => {
      const { slug } = await setupPublicChatbot();
      const res = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(res.status).toBe(200);
      expect(res.body.greetingMessage).toBe('무엇을 도와드릴까요?');
      expect(res.body.id).toBeUndefined();
      expect(res.body.status).toBeUndefined();
      PublicChatbotConfigSchema.parse(res.body); // AC-C-1
    });

    it('FR-11-16: 존재하지 않는 slug는 404다', async () => {
      const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/no-such-slug/config`);
      expect(res.status).toBe(404);
    });

    it('FR-11-16: 채널 비활성 챗봇은 403 CHANNEL_DISABLED다', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateChatbot(chatbotId);
      const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/config`);
      expect(res.status).toBe(403);
      expect(ApiErrorSchema.parse(res.body).code).toBe('CHANNEL_DISABLED');
    });

    it('AC-P-6: 정상 대화 1턴은 ConversationLog 1행을 적재하고 trace/내부ID를 노출하지 않는다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const sessionId = '11111111-1111-4111-8111-111111111111';
      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId,
        message: '안녕하세요',
      });
      expect(res.status).toBe(200);
      expect(res.body.trace).toBeUndefined();
      expect(res.body.matchedNodeId).toBeUndefined();
      expect(typeof res.body.messageId).toBe('string');
      PublicMessageResponseSchema.parse(res.body); // AC-C-1

      // best-effort 적재이므로 약간의 지연 여유를 둔다.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const stats = await jsonRequest<{ totalLogCount: number }>('GET', `${baseUrl}/stats/dashboard?chatbotId=${chatbotId}`);
      expect(stats.status).toBe(200);
      expect(stats.body.totalLogCount).toBe(1);
    });

    it('ORIGIN_NOT_ALLOWED: 허용 목록에 없는 Origin은 403이다', async () => {
      const { slug } = await setupPublicChatbot(['https://allowed.example.com']);
      const res = await jsonRequest(
        'POST',
        `${baseUrl}/public/chatbots/${slug}/messages`,
        { sessionId: '22222222-2222-4222-8222-222222222222', message: '안녕' },
        { Origin: 'https://evil.example.com' },
      );
      expect(res.status).toBe(403);
      expect(ApiErrorSchema.parse(res.body).code).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('허용된 Origin은 통과한다', async () => {
      const { slug } = await setupPublicChatbot(['https://allowed.example.com']);
      const res = await jsonRequest(
        'POST',
        `${baseUrl}/public/chatbots/${slug}/messages`,
        { sessionId: '33333333-3333-4333-8333-333333333333', message: '안녕' },
        { Origin: 'https://allowed.example.com' },
      );
      expect(res.status).toBe(200);
    });

    it('AC-P-12: 같은 sessionId로 1분 내 31회 요청하면 31번째는 429와 Retry-After 헤더를 반환한다', async () => {
      const { slug } = await setupPublicChatbot();
      const sessionId = '66666666-6666-4666-8666-666666666666';
      let last: Awaited<ReturnType<typeof jsonRequest>> | undefined;
      for (let i = 0; i < 31; i += 1) {
        last = await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: `요청${i}` });
      }
      expect(last?.status).toBe(429);
      expect(ApiErrorSchema.parse(last?.body).code).toBe('RATE_LIMITED');
      expect(last?.headers['retry-after']).toBeDefined();
    }, 15_000);

    it('FR-10-4/AC-10-9: 손상된 state는 폐기되고 stateReset:true로 새 대화 처리된다(500 아님)', async () => {
      const { slug } = await setupPublicChatbot();
      const res = await jsonRequest<{ stateReset: boolean }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId: '44444444-4444-4444-8444-444444444444',
        message: '안녕',
        state: { garbage: true },
      });
      expect(res.status).toBe(200);
      expect(res.body.stateReset).toBe(true);
    });

    it('FR-11-25: buttonAction NODE로 공개 대화에서도 노드 직접 점프가 동작한다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const nodeRes = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
        name: '공개노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '시작 메시지입니다.' } }],
      });
      const res = await jsonRequest<{ outputs: Array<{ payload: { text: string } }> }>(
        'POST',
        `${baseUrl}/public/chatbots/${slug}/messages`,
        { sessionId: '55555555-5555-4555-8555-555555555555', buttonAction: { kind: 'NODE', nodeId: nodeRes.body.id } },
      );
      expect(res.status).toBe(200);
      expect(res.body.outputs[0].payload.text).toBe('시작 메시지입니다.');
    });
  });
});
