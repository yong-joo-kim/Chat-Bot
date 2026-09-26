import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PublicMessageResponseSchema } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 채널별 리치 메시지(No.46) 통합 시험 — `docs/requirements/channel-rich-messages.md`(AC-RM1~RM7) ·
 * `docs/02-spec/channel-rich-messages-설계.md` §18.1 대비. 순수 함수(강등 사다리·URL 판정)는
 * `rich-messages/lib/*.spec.ts`가, 엔진 분기(EN-1~EN-6)는 `dialogue-engine/src/rich-messages.spec.ts`가
 * 담당한다 — 이 파일은 HTTP 계약 레벨(저장 검증·강등·허용 목록·금지어·로그·권한)을 다룬다.
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows 파일 핸들 지연 해제 — 정리 실패는 판정에 영향 없음.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, opts: { cookie?: string } = {}): Promise<ApiResponse<T>> {
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
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('채널별 리치 메시지(No.46) 통합 시험', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;

  let adminCookie = '';
  let viewerCookie = '';

  let chatbotId: string;
  let slug: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-rich-messages-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');

    const group = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `리치메시지그룹-${Math.random().toString(36).slice(2, 8)}` });
    const suffix = Math.random().toString(36).slice(2, 10);
    slug = `rm-itest-${suffix}`;
    const bot = await admin<{ id: string }>('POST', '/chatbots', { groupId: group.body.id, name: '리치메시지봇', slug });
    chatbotId = bot.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: adminCookie });
  }
  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: viewerCookie });
  }
  function anon<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body);
  }

  /** `ConversationLog` 적재는 fire-and-forget이다(§6 규약 ②) — 폴링으로 확인한다(CLAUDE.md). */
  async function pollConversationLog(userMessage: string, maxWaitMs = 5000): Promise<{ botResponse: string } | null> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const log = await prisma.conversationLog.findFirst({ where: { chatbotId, userMessage }, orderBy: { createdAt: 'desc' } });
      if (log) return log;
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function createIntent(examples: string[], name: string): Promise<string> {
    const res = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples });
    expect(res.status).toBe(201);
    return res.body.intent.id;
  }

  async function createNode(body: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> {
    return admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, body);
  }

  function carouselOutput(overrides: { cards?: unknown[] } = {}): Record<string, unknown> {
    return {
      type: 'CAROUSEL',
      payload: {
        version: 1,
        cards: overrides.cards ?? [
          { title: '요금제 A', description: '월 3만원' },
          { title: '요금제 B', description: '월 5만원' },
        ],
      },
    };
  }

  describe('AC-RM2-1: 캐러셀 카드 수·버튼 수 상한', () => {
    it('카드 1장(하한 미달)은 400 VALIDATION_FAILED', async () => {
      const res = await createNode({ name: `카드1장-${Date.now()}`, intentIds: [await createIntent(['카드1장예문'], `intent-${Date.now()}-1`)], outputs: [carouselOutput({ cards: [{ title: '단일카드' }] })] });
      expect(res.status).toBe(400);
    });

    it('카드 11장(상한 초과)은 400', async () => {
      const cards = Array.from({ length: 11 }, (_, i) => ({ title: `카드${i}` }));
      const res = await createNode({ name: `카드11장-${Date.now()}`, intentIds: [await createIntent(['카드11장예문'], `intent-${Date.now()}-2`)], outputs: [carouselOutput({ cards })] });
      expect(res.status).toBe(400);
    });

    it('카드당 버튼 4개(상한 3 초과)는 400', async () => {
      const buttons = Array.from({ length: 4 }, (_, i) => ({ label: `버튼${i}`, action: 'MESSAGE', value: `메시지${i}` }));
      const res = await createNode({
        name: `버튼4개-${Date.now()}`,
        intentIds: [await createIntent(['버튼4개예문'], `intent-${Date.now()}-3`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', buttons }, { title: '카드2' }] })],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('AC-RM2-2: 캐러셀 카드 버튼 NODE 참조 보호', () => {
    it('저장 시 존재하지 않는 노드를 참조하면 404 INVALID_REFERENCE + 필드 경로에 cards가 포함된다', async () => {
      const res = await createNode({
        name: `참조없음-${Date.now()}`,
        intentIds: [await createIntent(['참조없음예문'], `intent-${Date.now()}-4`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', buttons: [{ label: '이동', action: 'NODE', value: '00000000-0000-4000-8000-000000000000' }] }, { title: '카드2' }] })],
      });
      expect(res.status).toBe(404);
      expect((res.body as unknown as { code: string }).code).toBe('INVALID_REFERENCE');
      const details = (res.body as { details?: Array<{ field: string }> }).details ?? [];
      expect(details.some((d) => d.field.includes('cards'))).toBe(true);
    });

    it('캐러셀 카드 버튼이 참조하는 노드를 삭제하려 하면 409(기존 CARD 버튼과 동일한 보호)', async () => {
      const targetIntentId = await createIntent(['타깃노드예문'], `intent-${Date.now()}-5`);
      const target = await createNode({ name: `타깃노드-${Date.now()}`, intentIds: [targetIntentId], outputs: [{ type: 'TEXT', payload: { text: '타깃 응답' } }] });
      expect(target.status).toBe(201);

      const sourceIntentId = await createIntent(['소스노드예문'], `intent-${Date.now()}-6`);
      const source = await createNode({
        name: `소스노드-${Date.now()}`,
        intentIds: [sourceIntentId],
        outputs: [carouselOutput({ cards: [{ title: '카드1', buttons: [{ label: '이동', action: 'NODE', value: target.body.id }] }, { title: '카드2' }] })],
      });
      expect(source.status).toBe(201);

      const del = await admin('DELETE', `/chatbots/${chatbotId}/dialog-nodes/${target.body.id}`);
      expect(del.status).toBe(409);
    });
  });

  describe('AC-RM2-3: 바로연결 배치 규칙', () => {
    it('바로연결(display=QUICK_REPLY)에 LINK 버튼이 있으면 400', async () => {
      const res = await createNode({
        name: `바로연결링크-${Date.now()}`,
        intentIds: [await createIntent(['바로연결링크예문'], `intent-${Date.now()}-7`)],
        outputs: [{ type: 'BUTTON', payload: { buttons: [{ label: '링크', action: 'LINK', value: 'https://example.com' }], display: 'QUICK_REPLY' } }],
      });
      expect(res.status).toBe(400);
    });

    it('바로연결 뒤에 다른 표시 아웃풋이 있으면 400 OUTPUT_PAYLOAD_INVALID', async () => {
      const res = await createNode({
        name: `바로연결끝아님-${Date.now()}`,
        intentIds: [await createIntent(['바로연결끝아님예문'], `intent-${Date.now()}-8`)],
        outputs: [
          { type: 'BUTTON', payload: { buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }], display: 'QUICK_REPLY' } },
          { type: 'TEXT', payload: { text: '추가 안내' } },
        ],
      });
      expect(res.status).toBe(400);
      expect((res.body as unknown as { code: string }).code).toBe('OUTPUT_PAYLOAD_INVALID');
    });

    it('바로연결 뒤에 DIALOG_MOVE·WORKFLOW만 있으면 저장된다(허용된 뒤따르는 타입)', async () => {
      const moveTargetIntent = await createIntent(['이동대상예문'], `intent-${Date.now()}-9a`);
      const moveTarget = await createNode({ name: `이동대상-${Date.now()}`, intentIds: [moveTargetIntent], outputs: [{ type: 'TEXT', payload: { text: '이동 완료' } }] });
      const res = await createNode({
        name: `바로연결끝허용-${Date.now()}`,
        intentIds: [await createIntent(['바로연결끝허용예문'], `intent-${Date.now()}-9`)],
        outputs: [
          { type: 'BUTTON', payload: { buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }], display: 'QUICK_REPLY' } },
          { type: 'DIALOG_MOVE', payload: { targetNodeId: moveTarget.body.id } },
        ],
      });
      expect(res.status).toBe(201);
    });
  });

  describe('AC-RM1-1 · AC-RM3-1: rich-v1 선언 유무에 따른 캐러셀 강등 · 공개 응답 계약 준수', () => {
    let nodeIntentId: string;

    beforeAll(async () => {
      nodeIntentId = await createIntent(['요금제캐러셀문의'], `intent-${Date.now()}-carousel`);
      const created = await createNode({
        name: `요금제캐러셀-${Date.now()}`,
        intentIds: [nodeIntentId],
        outputs: [carouselOutput({ cards: [{ title: '요금제 A' }, { title: '요금제 B' }, { title: '요금제 C' }] })],
      });
      expect(created.status).toBe(201);
    });

    it('rich-v1을 선언하면 CAROUSEL 원형 그대로 응답하고 PublicMessageResponseSchema를 통과한다', async () => {
      const res = await anon('POST', `/public/chatbots/${slug}/messages`, {
        sessionId: '11111111-1111-4111-8111-111111111111',
        message: '요금제캐러셀문의',
        features: ['rich-v1'],
      });
      expect(res.status).toBe(200);
      expect(() => PublicMessageResponseSchema.parse(res.body)).not.toThrow();
      const outputs = (res.body as { outputs: Array<{ type: string }> }).outputs;
      expect(outputs.some((o) => o.type === 'CAROUSEL')).toBe(true);
    });

    it('rich-v1을 선언하지 않으면(구버전) CARD 여러 개로 강등되고 빈 말풍선이 없다(NFR-RMR1)', async () => {
      const res = await anon('POST', `/public/chatbots/${slug}/messages`, {
        sessionId: '22222222-2222-4222-8222-222222222222',
        message: '요금제캐러셀문의',
      });
      expect(res.status).toBe(200);
      expect(() => PublicMessageResponseSchema.parse(res.body)).not.toThrow();
      const outputs = (res.body as { outputs: Array<{ type: string }> }).outputs;
      expect(outputs.some((o) => o.type === 'CAROUSEL')).toBe(false);
      expect(outputs.filter((o) => o.type === 'CARD').length).toBe(3);
      expect(outputs.length).toBeGreaterThan(0);
    });

    it('새 컴포넌트를 쓰지 않는 노드의 응답은 rich-v1 유무와 무관하게 바이트 동일하다(AC-RM1-1)', async () => {
      const textIntentId = await createIntent(['일반텍스트문의'], `intent-${Date.now()}-text`);
      const created = await createNode({ name: `일반텍스트-${Date.now()}`, intentIds: [textIntentId], outputs: [{ type: 'TEXT', payload: { text: '일반 응답입니다' } }] });
      expect(created.status).toBe(201);

      const withRich = await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: '33333333-3333-4333-8333-333333333333', message: '일반텍스트문의', features: ['rich-v1'] });
      const withoutRich = await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: '44444444-4444-4444-8444-444444444444', message: '일반텍스트문의' });

      const stripVolatile = (body: unknown) => {
        const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
        delete clone.messageId;
        delete clone.state;
        return clone;
      };
      expect(stripVolatile(withRich.body)).toEqual(stripVolatile(withoutRich.body));
    });
  });

  describe('AC-RM5-1 · AC-RM5-2 · AC-RM5-5: 새 컴포넌트 주소 안전 · 허용 도메인 목록', () => {
    it('캐러셀 카드 이미지 http:// 는 400(https 전용)', async () => {
      const res = await createNode({
        name: `http이미지-${Date.now()}`,
        intentIds: [await createIntent(['http이미지예문'], `intent-${Date.now()}-http`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', imageUrl: 'http://img.example.com/a.png', altText: '대체' }, { title: '카드2' }] })],
      });
      expect(res.status).toBe(400);
    });

    it("캐러셀 카드 LINK 버튼 값에 '@'(사용자정보) 형식은 400", async () => {
      const res = await createNode({
        name: `at피싱-${Date.now()}`,
        intentIds: [await createIntent(['at피싱예문'], `intent-${Date.now()}-at`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', buttons: [{ label: '이동', action: 'LINK', value: 'https://bank.example.com@phish.example.net/login' }] }, { title: '카드2' }] })],
      });
      expect(res.status).toBe(400);
    });

    it('기존 CARD의 http 이미지는 하위 호환으로 계속 저장 가능하다', async () => {
      const res = await createNode({
        name: `기존카드http-${Date.now()}`,
        intentIds: [await createIntent(['기존카드http예문'], `intent-${Date.now()}-cardhttp`)],
        outputs: [{ type: 'CARD', payload: { title: '기존카드', imageUrl: 'http://img.example.com/legacy.png', altText: '대체' } }],
      });
      expect(res.status).toBe(201);
    });

    it('허용 도메인 목록 등록 후 목록 밖 호스트는 저장 거부, 목록 안 호스트는 저장 허용 + 감사 로그 1건', async () => {
      const put = await admin('PUT', `/chatbots/${chatbotId}/rich-url-policy`, { hosts: [{ host: 'img.allowed.example', includeSubdomains: false }] });
      expect(put.status).toBe(200);

      const disallowed = await createNode({
        name: `목록밖-${Date.now()}`,
        intentIds: [await createIntent(['목록밖예문'], `intent-${Date.now()}-outside`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', imageUrl: 'https://img.blocked.example/a.png', altText: '대체' }, { title: '카드2' }] })],
      });
      expect(disallowed.status).toBe(400);

      const allowed = await createNode({
        name: `목록안-${Date.now()}`,
        intentIds: [await createIntent(['목록안예문'], `intent-${Date.now()}-inside`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', imageUrl: 'https://img.allowed.example/a.png', altText: '대체' }, { title: '카드2' }] })],
      });
      expect(allowed.status).toBe(201);

      const auditRows = await prisma.auditLog.findMany({ where: { targetType: 'Chatbot', targetId: chatbotId, summary: { contains: '리치 메시지 허용 도메인 변경' } } });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);

      // 목록을 비워 다른 시험에 영향이 없게 되돌린다(허용 목록은 환경 밖 — 전역 상태).
      await admin('PUT', `/chatbots/${chatbotId}/rich-url-policy`, { hosts: [] });
    });
  });

  describe('코드 리뷰 R1 M-1: 노드 copy()도 저장 단언(바로연결 배치·허용 도메인 목록)을 거친다', () => {
    it('원본 저장 뒤 허용 도메인 목록이 좁아지면 사본 생성이 400으로 거부된다', async () => {
      const original = await createNode({
        name: `사본원본-${Date.now()}`,
        intentIds: [await createIntent(['사본원본예문'], `intent-${Date.now()}-copy-src`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1', imageUrl: 'https://img.allowed-for-copy.example/a.png', altText: '대체' }, { title: '카드2' }] })],
      });
      expect(original.status).toBe(201);

      // 원본 저장 시점에는 허용 목록이 비어 있어(제한 없음) 통과했다. 이제 목록을 좁힌다.
      const put = await admin('PUT', `/chatbots/${chatbotId}/rich-url-policy`, {
        hosts: [{ host: 'img.allowed.example', includeSubdomains: false }],
      });
      expect(put.status).toBe(200);

      const copyRes = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes/${original.body.id}/copy`, {});
      expect(copyRes.status).toBe(400);

      // 목록을 비워 다른 시험에 영향이 없게 되돌린다.
      await admin('PUT', `/chatbots/${chatbotId}/rich-url-policy`, { hosts: [] });
    });

    it('허용 도메인 목록이 좁아지지 않았으면 사본 생성이 정상적으로 성공한다', async () => {
      const original = await createNode({
        name: `사본원본정상-${Date.now()}`,
        intentIds: [await createIntent(['사본원본정상예문'], `intent-${Date.now()}-copy-ok`)],
        outputs: [carouselOutput({ cards: [{ title: '카드1' }, { title: '카드2' }] })],
      });
      expect(original.status).toBe(201);

      const copyRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes/${original.body.id}/copy`, {});
      expect(copyRes.status).toBe(201);
      expect(copyRes.body.id).not.toBe(original.body.id);
    });

    it('바로연결(display=QUICK_REPLY) 배치 규칙도 copy()에서 같이 검사된다(방어적 — 정상 원본은 그대로 통과)', async () => {
      const original = await createNode({
        name: `사본바로연결원본-${Date.now()}`,
        intentIds: [await createIntent(['사본바로연결예문'], `intent-${Date.now()}-copy-qr`)],
        outputs: [{ type: 'BUTTON', payload: { buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }], display: 'QUICK_REPLY' } }],
      });
      expect(original.status).toBe(201);

      const copyRes = await admin('POST', `/chatbots/${chatbotId}/dialog-nodes/${original.body.id}/copy`, {});
      expect(copyRes.status).toBe(201);
    });
  });

  describe('AC-RM4-4: 허용 도메인 목록 권한(VIEWER 조회만 가능)', () => {
    it('VIEWER는 조회 200, 변경은 403', async () => {
      const get = await viewer('GET', `/chatbots/${chatbotId}/rich-url-policy`);
      expect(get.status).toBe(200);
      const put = await viewer('PUT', `/chatbots/${chatbotId}/rich-url-policy`, { hosts: [] });
      expect(put.status).toBe(403);
    });
  });

  describe('AC-RM6-1 · AC-RM6-2: 금지어 마스킹 · 로그 요약', () => {
    it('캐러셀 카드 제목·설명·안내 문구의 금지어가 공개 응답에서 마스킹된다', async () => {
      const bannedWord = await admin<{ id: string }>('POST', `/banned-words`, { word: '바보', matchType: 'EXACT', policy: 'WARN', enabled: true });
      expect(bannedWord.status).toBe(201);

      const intentId = await createIntent(['금지어캐러셀문의'], `intent-${Date.now()}-banned`);
      const created = await createNode({
        name: `금지어캐러셀-${Date.now()}`,
        intentIds: [intentId],
        outputs: [{ type: 'CAROUSEL', payload: { version: 1, text: '바보 안내', cards: [{ title: '바보 카드', description: '바보 설명' }, { title: '카드2' }] } }],
      });
      expect(created.status).toBe(201);

      const res = await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: '55555555-5555-4555-8555-555555555555', message: '금지어캐러셀문의', features: ['rich-v1'] });
      expect(res.status).toBe(200);
      const carousel = (res.body as { outputs: Array<{ type: string; payload: { text?: string; cards: Array<{ title: string; description?: string }> } }> }).outputs.find((o) => o.type === 'CAROUSEL');
      expect(carousel).toBeDefined();
      expect(carousel!.payload.text).not.toContain('바보');
      expect(carousel!.payload.cards[0].title).not.toContain('바보');
      expect(carousel!.payload.cards[0].description).not.toContain('바보');

      const log = await pollConversationLog('금지어캐러셀문의');
      expect(log).toBeDefined();
      expect(log!.botResponse).toContain('[캐러셀]');
      expect(log!.botResponse.length).toBeGreaterThan(0);
    }, 10_000);

    it('캐러셀만 있는 턴의 대화 로그 botResponse는 빈 문자열이 아니라 [캐러셀] 요약이다', async () => {
      const intentId = await createIntent(['캐러셀요약문의'], `intent-${Date.now()}-summary`);
      const created = await createNode({
        name: `캐러셀요약-${Date.now()}`,
        intentIds: [intentId],
        outputs: [carouselOutput({ cards: [{ title: '요약카드1' }, { title: '요약카드2' }] })],
      });
      expect(created.status).toBe(201);

      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: '66666666-6666-4666-8666-666666666666', message: '캐러셀요약문의', features: ['rich-v1'] });

      const log = await pollConversationLog('캐러셀요약문의');
      expect(log?.botResponse).toContain('[캐러셀]');
      expect(log?.botResponse).toContain('요약카드1');
    }, 10_000);
  });

  describe('AC-RM4-2: No.42 시뮬레이션 degradePreview 채움', () => {
    it('가상 채널 KAKAOTALK로 캐러셀 노드를 시뮬레이션하면 degradePreview가 ASSUMED 객체다', async () => {
      const settingsRes = await admin('PUT', `/chatbots/${chatbotId}/inbox-settings`, { enabled: true, openOnWarning: false });
      expect(settingsRes.status).toBe(200);

      const customerRes = await admin<{ customerId: string; threadId: string }>('POST', '/inbox/test-customers', { label: '리치메시지시험고객' });
      expect(customerRes.status).toBe(201);

      const intentId = await createIntent(['카카오캐러셀문의'], `intent-${Date.now()}-kakao`);
      const created = await createNode({
        name: `카카오캐러셀-${Date.now()}`,
        intentIds: [intentId],
        outputs: [carouselOutput({ cards: [{ title: '카카오카드1' }, { title: '카카오카드2' }] })],
      });
      expect(created.status).toBe(201);

      const simulateKakao = await admin<{ degradePreview: { channelType: string; source: string; changes: unknown[] } }>(
        'POST',
        `/inbox/test-customers/${customerRes.body.customerId}/simulate`,
        { chatbotId, simulatedChannel: 'KAKAOTALK', message: '카카오캐러셀문의' },
      );
      expect(simulateKakao.status).toBe(201);
      expect(simulateKakao.body.degradePreview).not.toBe('NOT_DEFINED');
      expect(simulateKakao.body.degradePreview.channelType).toBe('KAKAOTALK');
      expect(simulateKakao.body.degradePreview.source).toBe('ASSUMED');

      const simulateWeb = await admin<{ degradePreview: { channelType: string; source: string; changes: unknown[] } }>(
        'POST',
        `/inbox/test-customers/${customerRes.body.customerId}/simulate`,
        { chatbotId, simulatedChannel: 'WEB', message: '카카오캐러셀문의' },
      );
      expect(simulateWeb.status).toBe(201);
      expect(simulateWeb.body.degradePreview.channelType).toBe('WEB');
      expect(simulateWeb.body.degradePreview.source).toBe('MEASURED');
      expect(simulateWeb.body.degradePreview.changes).toEqual([]);
    });
  });

  describe('AC-RM7-6: 위젯 기능 선언 계약(요청 스키마 — 서버 계약만 확인, 위젯 자체는 frontend 범위)', () => {
    it("features 배열에 'rich-v1'을 포함해 보내면 400 없이 정상 처리된다(최대 5개 이내)", async () => {
      const res = await anon('POST', `/public/chatbots/${slug}/messages`, {
        sessionId: '77777777-7777-4777-8777-777777777777',
        message: '안녕',
        features: ['handoff-v1', 'feedback-v1', 'rich-v1'],
      });
      expect(res.status).toBe(200);
    });
  });
});
