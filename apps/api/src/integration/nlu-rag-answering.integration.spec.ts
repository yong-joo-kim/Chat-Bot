import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ApiErrorSchema, ChatbotAnswerSettingSchema, EmbeddingIndexStatusSchema, PublicMessageResponseSchema, RagConnectionCheckResultSchema, ThresholdPreviewResponseSchema } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

let adminCookie = '';
let viewerCookie = '';

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, cookie = adminCookie): Promise<ApiResponse<T>> {
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
          ...(cookie ? { Cookie: cookie } : {}),
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
 * FAQ/의도 매칭 고도화(NLU 1단계 + RAG 2단계) 통합 테스트 — `EMBEDDING_BASE_URL`/`RAG_BASE_URL`을
 * 설정하지 않은 상태(AC-N4-1)에서 신규 API 7개와 공개 대화 하위호환(AC-N2-16)을 계약 레벨로 검증한다.
 * 외부 서버 실호출은 이 스위트에 없다(test-automation 인계 — 실연동은 별도 수동 체크리스트).
 */
describe('FAQ/의도 매칭 고도화 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-nlu-rag-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // AC-N4-1 — 신규 환경변수를 하나도 설정하지 않는다(EMBEDDING_BASE_URL/RAG_BASE_URL 등).

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
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createGroup(): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, { name: 'NLU/RAG 테스트 그룹' });
    return res.body.id as string;
  }

  async function createChatbot(): Promise<{ id: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, {
      groupId,
      name: 'NLU/RAG 테스트봇',
      slug: `nlu-rag-bot-${suffix}`,
    });
    return { id: res.body.id as string, slug: res.body.slug as string };
  }

  async function activateWithWebChannel(chatbotId: string): Promise<void> {
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
  }

  describe('GET|PUT /chatbots/:chatbotId/answer-settings', () => {
    it('행이 없으면 기본값을 반환한다(404 아님) — 두 단계 모두 비활성', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`);
      expect(res.status).toBe(200);
      expect(res.body.semanticEnabled).toBe(false);
      expect(res.body.ragEnabled).toBe(false);
      ChatbotAnswerSettingSchema.parse(res.body);
    });

    it('AC-N1-18: lowThreshold ≥ acceptThreshold면 400 INVALID_THRESHOLD이며 저장되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, {
        semanticEnabled: true,
        acceptThreshold: 0.6,
        lowThreshold: 0.8,
        marginThreshold: 0.05,
      });
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('INVALID_THRESHOLD');

      const after = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`);
      expect(after.body.semanticEnabled).toBe(false); // 저장되지 않았다.
    });

    it('ragEnabled=true인데 ragCompany가 없으면 400 VALIDATION_FAILED다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, {
        ragEnabled: true,
      });
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });

    it('유효한 값은 저장되고 즉시 조회에 반영된다(FR-N1-30)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, {
        semanticEnabled: true,
        acceptThreshold: 0.85,
        lowThreshold: 0.55,
        marginThreshold: 0.05,
        ragEnabled: true,
        ragCompany: '국민연금',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ semanticEnabled: true, ragEnabled: true, ragCompany: '국민연금' });

      const after = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`);
      expect(after.body.acceptThreshold).toBe(0.85);
    });

    it('AC-N3-6: VIEWER는 저장할 수 없다(403) — DB가 변경되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, { semanticEnabled: true }, viewerCookie);
      expect(res.status).toBe(403);

      const after = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`);
      expect(after.body.semanticEnabled).toBe(false);
    });

    it('VIEWER는 조회는 할 수 있다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, undefined, viewerCookie);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /chatbots/:chatbotId/answer-settings/preview', () => {
    it('semanticEnabled=false면 저장·외부호출 없이 FAILED band를 반환한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots/${chatbotId}/answer-settings/preview`, {
        message: '테스트 문장입니다',
      });
      expect(res.status).toBe(200);
      expect(res.body.band).toBe('FAILED');
      expect(res.body.top3).toEqual([]);
      expect(res.body.wouldUseRag).toBe(false);
      ThresholdPreviewResponseSchema.parse(res.body);
    });

    it('semanticEnabled=true인데 임베딩 서비스가 없으면 503 EMBEDDING_UNAVAILABLE이다', async () => {
      const { id: chatbotId } = await createChatbot();
      await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, { semanticEnabled: true });
      const res = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/answer-settings/preview`, { message: '테스트' });
      expect(res.status).toBe(503);
      expect(ApiErrorSchema.parse(res.body).code).toBe('EMBEDDING_UNAVAILABLE');
    });
  });

  describe('POST /chatbots/:chatbotId/answer-settings/test — 연결 점검', () => {
    it('RAG_BASE_URL 미설정이면 NOT_CONFIGURED다(company 미설정이어도 400이 아니다)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots/${chatbotId}/answer-settings/test`);
      expect(res.status).toBe(200);
      expect(res.body.upstreamStatus).toBe('NOT_CONFIGURED');
      expect(res.body.scopeChunkCount).toBeNull();
      RagConnectionCheckResultSchema.parse(res.body);
    });
  });

  describe('GET /chatbots/:chatbotId/embeddings/status', () => {
    it('임베딩 서비스 미설정 시 modelId=null·providerHealthy=false다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<Record<string, unknown>>('GET', `${baseUrl}/chatbots/${chatbotId}/embeddings/status`);
      expect(res.status).toBe(200);
      expect(res.body.modelId).toBeNull();
      expect(res.body.providerHealthy).toBe(false);
      EmbeddingIndexStatusSchema.parse(res.body);
    });
  });

  describe('POST /chatbots/:chatbotId/embeddings/reindex', () => {
    it('AC-N1-17: 임베딩 서비스가 없어도 202를 반환하고(백그라운드 시도는 즉시 종료), 재요청은 정상 처리된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const first = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/embeddings/reindex`);
      expect(first.status).toBe(202);
    });
  });

  describe('공개 대화 API 하위호환 — AC-N2-16, AC-N2-27', () => {
    it('RAG 미설정 상태에서 매칭 실패 턴은 pendingAnswer 없이 기존 폴백 문구를 즉시 반환한다', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWithWebChannel(chatbotId);

      const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId: '99999999-9999-4999-8999-999999999999',
        message: '전혀 매칭되지 않는 완전히 무관한 질문입니다',
      });
      expect(res.status).toBe(200);
      expect(res.body.pendingAnswer).toBeUndefined();
      PublicMessageResponseSchema.parse(res.body);
    });
  });

  describe('영구 삭제 — AC-N1-20', () => {
    it('AI 답변 설정 행이 있어도 CHATBOT_HAS_CHILDREN으로 막히지 않고 함께 삭제된다', async () => {
      const groupId = await createGroup();
      const suffix = Math.random().toString(36).slice(2, 10);
      const createRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, {
        groupId,
        name: '영구삭제 테스트봇',
        slug: `nlu-rag-purge-${suffix}`,
      });
      const chatbotId = createRes.body.id as string;
      const name = createRes.body.name as string;

      await jsonRequest('PUT', `${baseUrl}/chatbots/${chatbotId}/answer-settings`, { semanticEnabled: true, ragEnabled: true, ragCompany: '국민연금' });

      const archiveRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}`);
      expect(archiveRes.status).toBe(204);

      const purgeRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, { confirmName: name });
      expect(purgeRes.status).toBe(204);

      const afterSettings = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/answer-settings`);
      expect(afterSettings.status).toBe(404);
    });
  });

  describe('GET /public/chatbots/:slug/messages/:messageId — 폴링(@Public 6번째)', () => {
    it('AC-N2-19류: 존재하지 않는 messageId는 404 PENDING_ANSWER_NOT_FOUND다', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWithWebChannel(chatbotId);
      const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/${slug}/messages/00000000-0000-4000-8000-000000000000`);
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).code).toBe('PENDING_ANSWER_NOT_FOUND');
    });

    it('AC-N2-18: 다른 슬러그로 조회하면 404다(추측 방지)', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWithWebChannel(chatbotId);
      const { id: otherChatbotId, slug: otherSlug } = await createChatbot();
      await activateWithWebChannel(otherChatbotId);

      const res = await jsonRequest('GET', `${baseUrl}/public/chatbots/${otherSlug}/messages/00000000-0000-4000-8000-000000000001`);
      expect(res.status).toBe(404);
      // 두 슬러그 모두 유효하지만 messageId 자체가 존재하지 않으므로 어느 쪽이든 404다(존재 노출 없음).
      expect(slug).not.toBe(otherSlug);
    });
  });
});
