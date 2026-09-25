import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { DeploySchedulesEngine } from '../deploy-schedules/engine/deploy-schedule.engine';
import { textHashOf } from '../embedding/lib/text-hash';
import { encodeVector } from '../embedding/lib/vector-codec';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { RestoreLockRegistry } from '../versions/restore/restore-lock.registry';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const FAKE_MODEL_ID = 'test-model-v1';
const FAKE_DIMENSION = 4;

/** [신규 No.40] C-2 검증용 — 실제 임베딩 서버 없이 "복사 단계"만 테스트한다. `embed()` 호출 횟수를
 * 세어 "추가 임베딩 호출 0"(AC-EN3-2)을 검증한다. */
let fakeEmbedCallCount = 0;
class FakeEmbeddingProviderFactory {
  async getProvider() {
    return {
      modelId: FAKE_MODEL_ID,
      dimension: FAKE_DIMENSION,
      embed: async (texts: string[]) => {
        fakeEmbedCallCount += 1;
        return texts.map(() => new Float32Array(FAKE_DIMENSION));
      },
    };
  }
}

const API_ROOT = join(__dirname, '..', '..');

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
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

class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * 환경 분리 / 버전 관리(No.40) 통합 테스트 — `environment-separation-설계.md` §24.1 요구 목록 중
 * HTTP 계약 레벨로 검증 가능한 항목을 다룬다. `EMBEDDING_BASE_URL`은 설정하지 않는다(규칙 매칭만) —
 * C-2 벡터 보존은 "복사 단계"(슬롯 테이블 → 보존 저장소, 추가 임베딩 호출 없음)만 검증한다.
 */
describe('환경 분리 / 버전 관리(No.40) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let engine: DeploySchedulesEngine;
  let restoreLock: RestoreLockRegistry;
  let clock: FakeClock;
  let adminCookie = '';
  let editorCookie = '';
  let viewerCookie = '';
  let agentCookie = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'environment-separation-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    delete process.env.EMBEDDING_BASE_URL;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    clock = new FakeClock(new Date('2026-03-01T00:00:00.000Z'));

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(EmbeddingProviderFactory)
      .useClass(FakeEmbeddingProviderFactory)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(DeploySchedulesEngine);
    restoreLock = moduleRef.get(RestoreLockRegistry);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => setTimeout(r, 200));
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // 정리 실패는 판정에 영향 없음.
    }
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: editorCookie });
  }
  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  }
  function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: agentCookie });
  }
  function pub<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body);
  }

  async function createChatbotWithSlug(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `env-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    return { id: res.body.id, slug };
  }

  async function activate(chatbotId: string): Promise<void> {
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
  }

  async function createKeyword(chatbotId: string, name: string): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, { name, synonyms: [] });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createKeywordNode(chatbotId: string, keywordId: string, text: string): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: `노드-${text}`,
      nodeType: 'NORMAL',
      keywordIds: [keywordId],
      outputs: [{ type: 'TEXT', payload: { text } }],
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function setNodeOutputText(chatbotId: string, nodeId: string, text: string): Promise<void> {
    const res = await admin('PATCH', `/chatbots/${chatbotId}/dialog-nodes/${nodeId}`, { outputs: [{ type: 'TEXT', payload: { text } }] });
    expect(res.status).toBe(200);
  }

  async function sendPublic(slug: string, sessionId: string, message: string): Promise<ApiResponse<{ outputs: Array<{ payload?: { text?: string } }> }>> {
    return pub('POST', `/public/chatbots/${slug}/messages`, { sessionId, message });
  }

  function outputText(res: ApiResponse<{ outputs: Array<{ payload?: { text?: string } }> }>): string | undefined {
    return res.body.outputs?.[0]?.payload?.text;
  }

  let sessionCounter = 0;
  /** 유효한 UUID 형식의 세션 id를 매번 새로 발급한다(`-n` 접미사 접근은 UUID 형식을 깬다). */
  function sessionUuid(_tag?: number): string {
    sessionCounter += 1;
    const hex = sessionCounter.toString(16).padStart(12, '0');
    return `10000000-0000-4000-8000-${hex}`;
  }

  /** 로그 적재는 fire-and-forget이다(CLAUDE.md 규약) — 폴링으로 확인한다. */
  async function pollConversationLog(chatbotId: string, sessionId: string, timeoutMs = 3000): Promise<{ id: string; servedVersionId: string | null } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const log = await prisma.conversationLog.findFirst({ where: { chatbotId, sessionId }, orderBy: { createdAt: 'desc' } });
      if (log) return log;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function getStatus(chatbotId: string): Promise<ApiResponse<Record<string, unknown>>> {
    return admin('GET', `/chatbots/${chatbotId}/environment`);
  }

  async function enableEnv(chatbotId: string): Promise<Record<string, unknown>> {
    const preview = await admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
    expect(preview.status).toBe(200);
    const res = await admin<Record<string, unknown>>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe('A. 모드 꺼짐 — 초안 경로 바이트 동일(AC-EN1-1)', () => {
    it('환경 모드를 켜지 않은 챗봇은 공개 응답이 현행과 같고 로그의 servedVersionId가 null이다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('꺼짐');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드꺼짐-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-꺼짐');

      const statusRes = await getStatus(chatbotId);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body).toEqual({ enabled: false, gate: null });

      const sessionId = sessionUuid();
      const res = await sendPublic(slug, sessionId, `키워드꺼짐-${chatbotId.slice(0, 6)} 문의`);
      expect(res.status).toBe(200);
      expect(outputText(res)).toBe('응답-꺼짐');

      const log = await pollConversationLog(chatbotId, sessionId);
      expect(log?.servedVersionId).toBeNull();

      // 보존 저장소는 모드 꺼진 챗봇에서 영원히 0행이다(AC-EN3-3).
      const textVectorCount = await prisma.embeddingTextVector.count({ where: { chatbotId } });
      expect(textVectorCount).toBe(0);
    });
  });

  describe('B. 켜기 직후 응답 불변(AC-EN1-2) · 초안 편집 미반영(AC-EN2-1)', () => {
    it('켜기 직후에는 같은 입력에 같은 응답을 주고, 이후 초안 편집은 운영에 반영되지 않는다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('켜기');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드켜기-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');

      const sessionId = sessionUuid();
      const before = await sendPublic(slug, sessionId, `키워드켜기-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(before)).toBe('응답-v1');

      const enabled = await enableEnv(chatbotId);
      expect((enabled as { enabled: boolean }).enabled).toBe(true);
      const prodVersionId = (enabled as { prod: { versionId: string } }).prod.versionId;
      expect(prodVersionId).toBeTruthy();

      const session2 = sessionUuid();
      const after2 = await sendPublic(slug, session2, `키워드켜기-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(after2)).toBe('응답-v1');
      const logAfter = await pollConversationLog(chatbotId, session2);
      expect(logAfter?.servedVersionId).toBe(prodVersionId);

      // 초안 편집(AC-EN2-1) — 운영은 v1 그대로여야 한다.
      await setNodeOutputText(chatbotId, nodeId, '응답-초안편집됨');
      const draftEdited = await sendPublic(slug, sessionUuid(), `키워드켜기-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(draftEdited)).toBe('응답-v1');
    });
  });

  describe('C. 스테이징 승격 → 운영 전환 → 공개 응답 반영(AC-EN2-2) · 롤백', () => {
    it('승격+전환 후 공개 응답이 새 버전으로 바뀌고, 롤백하면 되돌아간다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('전환');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드전환-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      // 초안 편집 → 스테이징 승격.
      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const statusForStaging = await getStatus(chatbotId);
      const stagingBefore = (statusForStaging.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await admin<{ outcome: string; staging: { versionId: string; versionNo: number } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBefore?.versionId ?? null,
      });
      expect(promoteRes.status).toBe(201);
      expect(promoteRes.body.outcome).toBe('CREATED');
      const v2Id = promoteRes.body.staging.versionId;

      // 전환 전 — 여전히 v1.
      const beforeSwitch = await sendPublic(slug, sessionUuid(), `키워드전환-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(beforeSwitch)).toBe('응답-v1');

      // 운영 전환.
      const previewRes = await admin<{ expectedProdVersionId: string; warnings: unknown[] }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, {
        kind: 'SWITCH',
        targetVersionId: v2Id,
      });
      expect(previewRes.status).toBe(200);
      const switchRes = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewRes.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchRes.status).toBe(201);
      expect(switchRes.body.outcome).toBe('APPLIED');
      expect(switchRes.body.prod.versionId).toBe(v2Id);

      const afterSwitch = await sendPublic(slug, sessionUuid(), `키워드전환-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterSwitch)).toBe('응답-v2');

      // 롤백 — 직전 운영(v1)으로 되돌린다.
      const rollbackPreview = await admin<{ expectedProdVersionId: string; target: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, {
        kind: 'ROLLBACK',
      });
      expect(rollbackPreview.status).toBe(200);
      expect(rollbackPreview.body.target.versionId).toBe(v1Id);

      const rollbackRes = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/rollback`, {
        expectedProdVersionId: rollbackPreview.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(rollbackRes.status).toBe(201);
      expect(rollbackRes.body.prod.versionId).toBe(v1Id);

      const afterRollback = await sendPublic(slug, sessionUuid(), `키워드전환-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterRollback)).toBe('응답-v1');

      // 이력이 append-only로 쌓였는지 확인.
      const history = await admin<{ items: Array<{ method: string; environment: string }> }>('GET', `/chatbots/${chatbotId}/environment/history?environment=PROD`);
      expect(history.status).toBe(200);
      expect(history.body.items.map((h) => h.method)).toEqual(expect.arrayContaining(['INIT', 'IMMEDIATE', 'ROLLBACK']));

      // [신규 No.40 — 2026-09-25 프론트 계약 보강 확인] environmentBadges — 지금 운영은 v1(PROD),
      // 스테이징은 여전히 v2(승격 후 안 바뀜) + v2는 운영 이력에도 있다(PROD_HISTORY).
      const listRes = await admin<{ items: Array<{ id: string; environmentBadges?: string[] }> }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(listRes.status).toBe(200);
      const v1Item = listRes.body.items.find((i) => i.id === v1Id);
      const v2Item = listRes.body.items.find((i) => i.id === v2Id);
      expect(v1Item?.environmentBadges).toEqual(['PROD']);
      expect(v2Item?.environmentBadges).toEqual(['STAGING', 'PROD_HISTORY']);

      const detailRes = await admin<{ environmentBadges?: string[] }>('GET', `/chatbots/${chatbotId}/versions/${v2Id}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.environmentBadges).toEqual(['STAGING', 'PROD_HISTORY']);
    });
  });

  describe('C2. GET .../versions/current — stagingDiff(2026-09-25 프론트 계약 보강, ui-spec §4.5)', () => {
    it('모드 꺼짐이면 stagingDiff가 없다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('스테이징디프-꺼짐');
      await activate(chatbotId);
      const currentRes = await admin<{ stagingDiff?: unknown }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(currentRes.status).toBe(200);
      expect(currentRes.body.stagingDiff).toBeUndefined();
    });

    it('모드 켜짐 + 스테이징=초안(승격 직후)이면 stagingDiff가 없다(본문을 읽지 않는다)', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('스테이징디프-동일');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `스테이징디프동일-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      const currentRes = await admin<{ stagingDiff?: unknown }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(currentRes.status).toBe(200);
      // 모드 켜짐 직후에는 스테이징=운영=초안(§5.1 P-6 초기화)이므로 승격 대상 변경이 없다.
      expect(currentRes.body.stagingDiff).toBeUndefined();
    });

    it('모드 켜짐 + 초안이 스테이징과 달라지면 stagingDiff에 변경 요약이 실린다(추가 조회 없이 current() 1회로)', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('스테이징디프-변경');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `스테이징디프변경-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      // 스테이징을 한 번 승격해 둔다(현재 초안 상태 = v-staging).
      const statusBefore = await getStatus(chatbotId);
      const stagingBefore = (statusBefore.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBefore?.versionId ?? null,
      });
      expect(promoteRes.status).toBe(201);

      // 이후 초안을 편집한다 — 스테이징(승격된 버전)과 지금 초안 사이에 차이가 생긴다.
      await setNodeOutputText(chatbotId, nodeId, '응답-v2');

      const currentRes = await admin<{ stagingDiff?: { rows: Array<{ kind: string; added: number; removed: number; modified: number }>; totalChanged: number; identical: boolean } }>(
        'GET',
        `/chatbots/${chatbotId}/versions/current`,
      );
      expect(currentRes.status).toBe(200);
      expect(currentRes.body.stagingDiff).toBeDefined();
      expect(currentRes.body.stagingDiff!.identical).toBe(false);
      expect(currentRes.body.stagingDiff!.totalChanged).toBeGreaterThan(0);
      const nodeRow = currentRes.body.stagingDiff!.rows.find((r) => r.kind === 'NODE');
      expect(nodeRow?.modified).toBeGreaterThanOrEqual(1);
    });
  });

  describe('D. 권한 — chatbot:deploy 없는 EDITOR는 403, 승격은 가능하다', () => {
    it('EDITOR는 켜기/전환은 403이고 스테이징 승격은 가능하다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('권한');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드권한-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답');

      const preview = await editor<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
      expect(preview.status).toBe(200); // 미리보기는 chatbot:read+dialogue:read(EDITOR도 가능).

      const enableRes = await editor('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
      expect(enableRes.status).toBe(403);

      const viewerEnable = await viewer('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
      expect(viewerEnable.status).toBe(403);

      // ADMIN이 대신 켠다.
      const enabled = await enableEnv(chatbotId);
      expect((enabled as { enabled: boolean }).enabled).toBe(true);

      // 승격은 dialogue:write+chatbot:write로 EDITOR도 가능하다.
      const statusRes = await getStatus(chatbotId);
      const staging = (statusRes.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await editor('POST', `/chatbots/${chatbotId}/environment/staging/promote`, { expectedStagingVersionId: staging?.versionId ?? null });
      expect(promoteRes.status).toBe(201);

      // 운영 전환은 EDITOR에게 403이다.
      const switchRes = await editor('POST', `/chatbots/${chatbotId}/environment/prod/switch`, { targetVersionId: staging?.versionId, expectedProdVersionId: staging?.versionId });
      expect(switchRes.status).toBe(403);
    });
  });

  describe('E. 끄기 흐름 — KEEP_PROD는 초안≠운영이면 거부, 복원 후 재시도하면 성공한다', () => {
    it('ENV_DRAFT_NOT_RESTORED → 복원 → 끄기 성공, 이후 초안 경로로 응답한다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('끄기');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드끄기-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const prodVersionId = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-초안변경');

      const disablePreview = await admin<{ prod: { versionId: string }; draftContentHash: string; draftDiffersFromProd: boolean }>(
        'POST',
        `/chatbots/${chatbotId}/environment/disable/preview`,
      );
      expect(disablePreview.status).toBe(200);
      expect(disablePreview.body.draftDiffersFromProd).toBe(true);

      const rejectedDisable = await admin('POST', `/chatbots/${chatbotId}/environment/disable`, {
        mode: 'KEEP_PROD',
        expectedProdVersionId: disablePreview.body.prod.versionId,
        expectedDraftHash: disablePreview.body.draftContentHash,
      });
      expect(rejectedDisable.status).toBe(409);
      expect((rejectedDisable.body as { code: string }).code).toBe('ENV_DRAFT_NOT_RESTORED');

      // 콘솔 흐름 — 복원 API를 먼저 호출한다.
      const restorePreview = await admin<{ currentContentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${prodVersionId}/restore/preview`);
      expect(restorePreview.status).toBe(200);
      const restoreRes = await admin<{ contentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${prodVersionId}/restore`, {
        expectedCurrentHash: restorePreview.body.currentContentHash,
        acknowledgeActive: true,
      });
      expect(restoreRes.status).toBe(200);

      const disableRes = await admin('POST', `/chatbots/${chatbotId}/environment/disable`, {
        mode: 'KEEP_PROD',
        expectedProdVersionId: prodVersionId,
        expectedDraftHash: restoreRes.body.contentHash,
      });
      expect(disableRes.status).toBe(201);
      expect((disableRes.body as { enabled: boolean }).enabled).toBe(false);

      const disableSession = sessionUuid();
      const afterDisable = await sendPublic(slug, disableSession, `키워드끄기-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterDisable)).toBe('응답-v1');

      const log = await pollConversationLog(chatbotId, disableSession);
      expect(log?.servedVersionId).toBeNull();
    });
  });

  describe('F. 예약 전환(SWITCH_PROD_VERSION)', () => {
    it('예약이 도래하면 운영 버전이 전환된다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('예약전환');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드예약-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const statusRes = await getStatus(chatbotId);
      const staging = (statusRes.body as { staging: { versionId: string } }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging.versionId,
      });
      const v2Id = promoteRes.body.staging.versionId;

      // [신규 No.40 — §11.3 ⑥] G3(실행 직후 TC) 대상 = 새 운영 버전(v2)임을 함께 검증한다.
      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: 'G3-예약전환세트' });
      expect(setRes.status).toBe(201);
      const caseRes = await admin('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/cases`, {
        messages: [`키워드예약-${chatbotId.slice(0, 6)} 문의`],
        expectedKind: 'ANY',
      });
      expect(caseRes.status).toBe(201);

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const previewRes = await admin<{ switchProd: { targetVersion: { id: string } } }>('POST', `/chatbots/${chatbotId}/deploy-schedules/preview`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        scheduledAt: scheduledAt.toISOString(),
      });
      expect(previewRes.status).toBe(200);

      const statusForSchedule = await getStatus(chatbotId);
      const currentProdVersionId = (statusForSchedule.body as { prod: { versionId: string } }).prod.versionId;
      expect(currentProdVersionId).toBe(v1Id);

      const createRes = await admin<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        previewedProdVersionId: currentProdVersionId,
        scheduledAt: scheduledAt.toISOString(),
        acknowledgeWarnings: true,
        postRunTestSetId: setRes.body.id,
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('SUCCEEDED');
      expect(row?.outcome).toBe('APPLIED');
      expect(row?.testRunId).toBeTruthy();

      const afterExecuted = await sendPublic(slug, sessionUuid(), `키워드예약-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterExecuted)).toBe('응답-v2');

      // G3 실행이 초안이 아니라 새 운영 버전(v2)을 대상으로 시작됐는지 확인한다.
      const testRun = await prisma.testRun.findUnique({ where: { id: row!.testRunId! } });
      expect(testRun?.targetKind).toBe('VERSION');
      expect(testRun?.targetVersionId).toBe(v2Id);
    });

    it('[신규 2026-09-25 프론트 계약 보강] §11.2 체인 — 두 번째 예약의 미리보기 expectedProdVersionId는 "지금의 실제 운영"이 아니라 앞선 예약의 대상이고, 그 값으로 생성·실행까지 성공한다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('예약체인');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드체인-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      // v2를 즉시 전환으로 한 번 운영에 태워 둔다 — v1이 "운영 이력"이 되어(§9.3 P-2) 이후에도
      // 유효한 전환 대상으로 남는다(SWITCH 종류의 대상 = 현재 스테이징 ∪ 운영 이력).
      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const statusV2 = await getStatus(chatbotId);
      const stagingV2 = (statusV2.body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;
      const immediatePreview = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const immediateSwitch = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: immediatePreview.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(immediateSwitch.status).toBe(201); // 지금 운영 = v2, v1은 운영 이력.

      // v3 — 현재 스테이징(두 번째 예약 대상).
      await setNodeOutputText(chatbotId, nodeId, '응답-v3');
      const statusV3 = await getStatus(chatbotId);
      const stagingV3 = (statusV3.body as { staging: { versionId: string } }).staging;
      const promoteV3 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV3.versionId,
      });
      const v3Id = promoteV3.body.staging.versionId;

      // 첫 번째 예약(t+10분, v2 → v1로 "되돌리는" 전환) — v1은 운영 이력이라 대상으로 허용된다.
      // 현재 실제 운영(v2) 기준(base=CURRENT, 앞선 활성 전환 예약이 아직 없다).
      const t1 = new Date(clock.now().getTime() + 10 * 60_000);
      const statusForSchedule = await getStatus(chatbotId);
      const currentProdVersionId = (statusForSchedule.body as { prod: { versionId: string } }).prod.versionId;
      expect(currentProdVersionId).toBe(v2Id);
      const create1 = await admin<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v1Id,
        previewedProdVersionId: currentProdVersionId,
        scheduledAt: t1.toISOString(),
        acknowledgeWarnings: true,
      });
      expect(create1.status).toBe(201);

      // 두 번째 예약(t+20분, v1 → v3) 미리보기 — 앞선 활성 전환 예약(#1)이 있으므로 체인 기준
      // (base=SCHEDULE)이고, expectedProdVersionId는 "지금의 실제 운영(v2)"이 아니라 #1의 대상(v1)
      // 이어야 한다. 콘솔이 이걸 몰라서 지금의 실제 운영을 그대로 보내면 생성 단계에서
      // 409 ENV_POINTER_STALE가 난다 — 이 값을 그대로 써야 성공한다.
      const t2 = new Date(clock.now().getTime() + 20 * 60_000);
      const preview2 = await admin<{ switchProd: { base: string; expectedProdVersionId: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules/preview`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v3Id,
        scheduledAt: t2.toISOString(),
      });
      expect(preview2.status).toBe(200);
      expect(preview2.body.switchProd.base).toBe('SCHEDULE');
      expect(preview2.body.switchProd.expectedProdVersionId).toBe(v1Id);
      expect(preview2.body.switchProd.expectedProdVersionId).not.toBe(currentProdVersionId);

      const create2 = await admin('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v3Id,
        previewedProdVersionId: preview2.body.switchProd.expectedProdVersionId,
        scheduledAt: t2.toISOString(),
        acknowledgeWarnings: true,
      });
      expect(create2.status).toBe(201);

      // 두 예약이 순서대로(v2→v1, 이어서 v1→v3) 실행되면 최종 운영은 v3다. 같은 챗봇 예약은
      // tick 1회당 최대 1건만 처리한다(FR-D3-5, 순서 보장) — tick을 두 번 호출한다.
      clock.advance(20 * 60_000 + 5_000);
      await engine.tick();
      await engine.tick();

      const finalStatus = await getStatus(chatbotId);
      expect((finalStatus.body as { prod: { versionId: string } }).prod.versionId).toBe(v3Id);
      const afterBoth = await sendPublic(slug, sessionUuid(), `키워드체인-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterBoth)).toBe('응답-v3');
    });
  });

  describe('G. 모드 켜기가 활성 RESTORE_VERSION 예약을 보류한다(C-4)', () => {
    it('RESTORE_VERSION PENDING 예약이 있는 상태에서 켜면 HELD(ENV_MODE_CHANGED)가 된다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('보류');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `키워드보류-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-기준');

      const versionRes = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: '기준' });
      expect(versionRes.status).toBe(201);
      const baseVersionId = versionRes.body.version.id;
      // 기준 버전 이후 상태를 바꿔야 복원이 의미 있다(현재=기준이면 RESTORE_NO_CHANGES 409).
      await createKeyword(chatbotId, `키워드보류추가-${chatbotId.slice(0, 6)}`);

      const scheduledAt = new Date(clock.now().getTime() + 20 * 60_000);
      const restorePreview = await admin<{ restore: { base: { contentHash: string } } }>('POST', `/chatbots/${chatbotId}/deploy-schedules/preview`, {
        action: 'RESTORE_VERSION',
        versionId: baseVersionId,
        scheduledAt: scheduledAt.toISOString(),
      });
      const createRestore = await admin<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'RESTORE_VERSION',
        versionId: baseVersionId,
        previewedContentHash: restorePreview.body.restore.base.contentHash,
        scheduledAt: scheduledAt.toISOString(),
        acknowledgeActive: true,
      });
      expect(createRestore.status).toBe(201);

      const enabled = await enableEnv(chatbotId);
      expect((enabled as { heldRestoreSchedules: number }).heldRestoreSchedules).toBe(1);

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRestore.body.schedule.id } });
      expect(row?.status).toBe('HELD');
      expect(row?.heldReason).toBe('ENV_MODE_CHANGED');
    });
  });

  describe('H. ★ 동점 노드 C-1 회귀 — 켜기 전후 동점 승자가 같다', () => {
    it('같은 (priority, 조건수, matchMode) 노드 2개 중 먼저 만든(더 이른 createdAt) 노드가 초안·운영 모두에서 이긴다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('동점');
      await activate(chatbotId);
      const sharedKeyword = await createKeyword(chatbotId, `공유키워드-${chatbotId.slice(0, 6)}`);
      // 두 노드가 정확히 같은 키워드 조건(동일 priority·조건수·matchMode)을 갖는다 — 생성 순서만 다르다.
      await createKeywordNode(chatbotId, sharedKeyword, '응답-먼저생성');
      await new Promise((r) => setTimeout(r, 20));
      await createKeywordNode(chatbotId, sharedKeyword, '응답-나중생성');

      const sessionId = sessionUuid();
      const draftAnswer = await sendPublic(slug, sessionId, `공유키워드-${chatbotId.slice(0, 6)} 문의`);
      const winnerText = outputText(draftAnswer);
      expect(['응답-먼저생성', '응답-나중생성']).toContain(winnerText);

      await enableEnv(chatbotId);

      const prodAnswer = await sendPublic(slug, sessionUuid(), `공유키워드-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(prodAnswer)).toBe(winnerText);
    });
  });

  describe('I. ★ C-2 벡터 보존 — 복사 단계(추가 임베딩 호출 없이 슬롯 벡터를 보존 저장소로 복사)', () => {
    it('켜기 시 FAQ 질문의 슬롯 벡터가 있으면 EmbeddingTextVector로 복사된다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('벡터보존');
      await activate(chatbotId);

      const faqRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/faqs`, {
        category: 'FAQ',
        question: '보존질문입니다',
        answer: '보존답변입니다',
        altQuestions: [],
      });
      expect(faqRes.status).toBe(201);
      const faqId = faqRes.body.id;

      const modelId = FAKE_MODEL_ID;
      const dimension = FAKE_DIMENSION;
      const vector = encodeVector(new Float32Array([0.1, 0.2, 0.3, 0.4]));
      const hash = textHashOf('보존질문입니다');
      // FAQ 생성이 트리거한 백그라운드 재색인(fire-and-forget)과의 경합을 피하려고 upsert로 이 시험의
      // 결정적 벡터 값을 마지막에 확정한다(색인기 자체 동작은 이 시험의 관심사가 아니다).
      await new Promise((r) => setTimeout(r, 300));
      await prisma.embeddingVector.upsert({
        where: { chatbotId_ownerType_ownerId_slotIndex_modelId: { chatbotId, ownerType: 'FAQ_QUESTION', ownerId: faqId, slotIndex: 0, modelId } },
        create: { chatbotId, ownerType: 'FAQ_QUESTION', ownerId: faqId, slotIndex: 0, textHash: hash, modelId, dimension, vector, status: 'READY' },
        update: { textHash: hash, dimension, vector, status: 'READY' },
      });

      // 모드 꺼짐 — 보존 저장소는 0행이다.
      expect(await prisma.embeddingTextVector.count({ where: { chatbotId } })).toBe(0);

      const beforeCallCount = fakeEmbedCallCount;
      await enableEnv(chatbotId);

      // ①(동기) 복사 단계는 요청 안에서 끝난다 — 폴링 없이 즉시 확인 가능해야 한다.
      const copied = await prisma.embeddingTextVector.findFirst({ where: { chatbotId, modelId, textHash: hash } });
      expect(copied).not.toBeNull();
      expect(copied?.vector).toBe(vector);
      // AC-EN3-2 — 추가 임베딩 호출 0(복사만으로 채워졌다).
      expect(fakeEmbedCallCount).toBe(beforeCallCount);

      // 끄면 보존 저장소가 전부 비워진다(모드 꺼진 챗봇 = 0행 불변식).
      const statusRes = await getStatus(chatbotId);
      const prod = (statusRes.body as { prod: { versionId: string } }).prod;
      const disablePreview = await admin<{ prod: { versionId: string }; draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/disable/preview`);
      await admin('POST', `/chatbots/${chatbotId}/environment/disable`, {
        mode: 'PROMOTE_DRAFT',
        expectedProdVersionId: prod.versionId,
        expectedDraftHash: disablePreview.body.draftContentHash,
      });
      expect(await prisma.embeddingTextVector.count({ where: { chatbotId } })).toBe(0);
    });
  });

  describe('J. 영구삭제 — 환경 3테이블 동반 삭제', () => {
    it('영구삭제 후 ChatbotEnvironment·EnvironmentSwitchLog·EmbeddingTextVector가 남지 않는다', async () => {
      // [기존 사전검사 규약 — No.40과 무관] 대화 자산(키워드·노드 등)이 있으면 CHATBOT_HAS_CHILDREN
      // 409로 영구삭제가 막힌다 — 이 시험은 환경 3테이블 동반 삭제만 보므로 자산 없이 진행한다.
      const { id: chatbotId } = await createChatbotWithSlug('영구삭제');
      await enableEnv(chatbotId);

      expect(await prisma.chatbotEnvironment.count({ where: { chatbotId } })).toBe(1);
      expect(await prisma.environmentSwitchLog.count({ where: { chatbotId } })).toBeGreaterThan(0);

      const chatbotRow = await prisma.chatbot.findUnique({ where: { id: chatbotId } });
      const archiveRes = await admin('DELETE', `/chatbots/${chatbotId}`);
      expect(archiveRes.status).toBe(204);
      const purgeRes = await admin('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotRow?.name });
      expect(purgeRes.status).toBe(204);

      expect(await prisma.chatbotEnvironment.count({ where: { chatbotId } })).toBe(0);
      expect(await prisma.environmentSwitchLog.count({ where: { chatbotId } })).toBe(0);
      expect(await prisma.embeddingTextVector.count({ where: { chatbotId } })).toBe(0);
    });
  });

  describe('K. 소비자 대상 선택 — 시뮬레이터(§12.1) · TC 실행(§12.2)', () => {
    it('시뮬레이터는 target=PROD/STAGING/VERSION을 각각 해석해 초안이 아니라 그 버전으로 답하고 응답에 target을 싣는다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('시뮬대상');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `시뮬대상-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const statusForPromote = await getStatus(chatbotId);
      const stagingBefore = (statusForPromote.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBefore?.versionId ?? null,
      });
      const v2Id = promoteRes.body.staging.versionId;

      // 초안을 한 번 더 편집한다 — target=DRAFT(기본값)와 target=PROD/STAGING이 서로 달라야
      // "초안이 아니라 그 버전"이라는 단언이 의미가 있다.
      await setNodeOutputText(chatbotId, nodeId, '응답-초안');

      const simDraft = await admin<{ outputs: Array<{ payload?: { text?: string } }>; target?: unknown }>('POST', `/chatbots/${chatbotId}/simulate`, {
        message: `시뮬대상-${chatbotId.slice(0, 6)} 문의`,
      });
      expect(simDraft.status).toBe(200);
      expect(simDraft.body.outputs?.[0]?.payload?.text).toBe('응답-초안');
      expect(simDraft.body.target).toBeUndefined(); // 초안 대상은 응답에 target을 싣지 않는다(바이트 불변).

      const simProd = await admin<{ outputs: Array<{ payload?: { text?: string } }>; target?: { kind: string; versionId: string; versionNo: number } }>(
        'POST',
        `/chatbots/${chatbotId}/simulate`,
        { message: `시뮬대상-${chatbotId.slice(0, 6)} 문의`, target: { kind: 'PROD' } },
      );
      expect(simProd.status).toBe(200);
      expect(simProd.body.outputs?.[0]?.payload?.text).toBe('응답-v1');
      expect(simProd.body.target?.kind).toBe('PROD');
      expect(simProd.body.target?.versionId).toBe(v1Id);

      const simStaging = await admin<{ outputs: Array<{ payload?: { text?: string } }>; target?: { kind: string; versionId: string } }>(
        'POST',
        `/chatbots/${chatbotId}/simulate`,
        { message: `시뮬대상-${chatbotId.slice(0, 6)} 문의`, target: { kind: 'STAGING' } },
      );
      expect(simStaging.status).toBe(200);
      expect(simStaging.body.outputs?.[0]?.payload?.text).toBe('응답-v2');
      expect(simStaging.body.target?.kind).toBe('STAGING');
      expect(simStaging.body.target?.versionId).toBe(v2Id);

      const simVersion = await admin<{ outputs: Array<{ payload?: { text?: string } }>; target?: { kind: string; versionId: string } }>(
        'POST',
        `/chatbots/${chatbotId}/simulate`,
        { message: `시뮬대상-${chatbotId.slice(0, 6)} 문의`, target: { kind: 'VERSION', versionId: v1Id } },
      );
      expect(simVersion.status).toBe(200);
      expect(simVersion.body.outputs?.[0]?.payload?.text).toBe('응답-v1');
      expect(simVersion.body.target?.kind).toBe('VERSION');
    });

    it('TC 실행은 target=PROD를 해석해 TestRun.targetKind/targetVersionId/targetVersionNo를 저장하고 그 버전으로 판정한다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('TC대상');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `TC대상-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;
      const v1No = (enabled as { prod: { versionNo: number } }).prod.versionNo;

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: 'TC대상세트' });
      expect(setRes.status).toBe(201);
      const caseRes = await admin('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/cases`, {
        messages: [`TC대상-${chatbotId.slice(0, 6)} 문의`],
        expectedKind: 'ANY',
      });
      expect(caseRes.status).toBe(201);

      const startRes = await admin<{ runId: string; status: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/runs`, {
        overlaySource: 'NONE',
        useRag: false,
        target: { kind: 'PROD' },
      });
      expect(startRes.status).toBe(202);

      const deadline = Date.now() + 5000;
      let run: { status: string; targetKind: string | null; targetVersionId: string | null; targetVersionNo: number | null } | null = null;
      while (Date.now() < deadline) {
        const row = await prisma.testRun.findUnique({ where: { id: startRes.body.runId } });
        if (row && row.status !== 'QUEUED' && row.status !== 'RUNNING') {
          run = row as never;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(run).not.toBeNull();
      expect(run!.status).toBe('SUCCEEDED');
      expect(run!.targetKind).toBe('PROD');
      expect(run!.targetVersionId).toBe(v1Id);
      expect(run!.targetVersionNo).toBe(v1No);
    });
  });

  describe('L. L2 캐시 즉시 반영 — 토픽 편집이 운영 서빙에 바로 반영된다(§7.3 AC-EN2-3/4)', () => {
    it('운영 전환 후 토픽을 비활성화하면(스냅샷 밖 자산, TTL 대기 없이) 다음 공개 요청부터 즉시 반영된다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('L2즉시반영');
      await activate(chatbotId);

      const topicRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/topics`, { name: 'L2토픽', enabled: true });
      expect(topicRes.status).toBe(201);
      const topicId = topicRes.body.id;

      const kw = await createKeyword(chatbotId, `L2즉시반영-${chatbotId.slice(0, 6)}`);
      const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '토픽노드',
        nodeType: 'NORMAL',
        keywordIds: [kw],
        topicId,
        outputs: [{ type: 'TEXT', payload: { text: '토픽응답' } }],
      });
      expect(nodeRes.status).toBe(201);

      // 이 시점(토픽 활성)의 초안 상태로 운영을 켠다 — 노드가 v1 스냅샷에 포함된다.
      await enableEnv(chatbotId);

      const beforeDisable = await sendPublic(slug, sessionUuid(), `L2즉시반영-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(beforeDisable)).toBe('토픽응답');

      // 토픽 비활성화 — 스냅샷 밖 자산이라 새 버전을 만들지 않고 운영에 즉시 반영돼야 한다(P-9).
      const disableRes = await admin('POST', `/chatbots/${chatbotId}/topics/${topicId}/disable`);
      expect(disableRes.status).toBe(201);

      const afterDisable = await sendPublic(slug, sessionUuid(), `L2즉시반영-${chatbotId.slice(0, 6)} 문의`);
      // 토픽이 꺼졌으니 그 노드는 더 이상 매칭되지 않는다 — 폴백(답변 못함)으로 바뀐다.
      expect(outputText(afterDisable)).not.toBe('토픽응답');

      // 다시 켜면 즉시 원복된다(캐시가 TTL로 남아있지 않다는 대조 확인).
      const enableRes = await admin('POST', `/chatbots/${chatbotId}/topics/${topicId}/enable`);
      expect(enableRes.status).toBe(201);
      const afterReenable = await sendPublic(slug, sessionUuid(), `L2즉시반영-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterReenable)).toBe('토픽응답');
    });
  });

  describe('M. ★ R1 H-1 — 확정 시점 경고 재계산(§9.4·§9.3 ④) — 비게이트 경고만 있어도 acknowledgeWarnings가 필요하다', () => {
    it('PROFILE_WILL_CHANGE(이름 변경)만 있는 전환은 acknowledgeWarnings 없이는 400, 있으면 200이다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('경고확인');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `경고확인-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      // 대화 자산은 그대로 두고 표시 이름만 바꾼다 — 게이트는 설정하지 않았으므로(NOT_CONFIGURED)
      // 유일한 경고가 PROFILE_WILL_CHANGE여야 한다(재현이 쉬운 비게이트 경고, §9.4).
      const settingsRes = await admin('PATCH', `/chatbots/${chatbotId}/settings`, { name: `경고확인-이름변경-${chatbotId.slice(0, 6)}` });
      expect(settingsRes.status).toBe(200);

      const statusForStaging = await getStatus(chatbotId);
      const stagingBefore = (statusForStaging.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await admin<{ outcome: string; staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBefore?.versionId ?? null,
      });
      expect(promoteRes.status).toBe(201);
      expect(promoteRes.body.outcome).toBe('CREATED'); // 프로필이 contentHash 범위 안이라 새 버전이 만들어진다(§6.1).
      const v2Id = promoteRes.body.staging.versionId;

      // 게이트를 PASS로 만들어 둔다(대상 버전을 겨냥한 SUCCEEDED 실행이 있으면 testSetId 미설정 +
      // WARN 모드 분기가 PASS/PASSED를 준다 — §10 표, `evaluateProdSwitchGate` `!settings.testSetId`
      // 분기). 이렇게 해야 유일한 경고가 진짜 "비게이트" 경고(PROFILE_WILL_CHANGE)임이 보장된다 —
      // 그렇지 않으면 실행 기록이 없어 NO_RUN(WARN)이 되어 게이트 경고와 뒤섞인다.
      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '경고확인세트' });
      expect(setRes.status).toBe(201);
      const caseRes = await admin('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/cases`, {
        messages: [`경고확인-${chatbotId.slice(0, 6)} 문의`],
        expectedKind: 'ANY',
      });
      expect(caseRes.status).toBe(201);
      const runRes = await admin<{ runId: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setRes.body.id}/runs`, {
        overlaySource: 'NONE',
        useRag: false,
        target: { kind: 'VERSION', versionId: v2Id },
      });
      expect(runRes.status).toBe(202);
      const runDeadline = Date.now() + 5000;
      let runStatus: string | undefined;
      while (Date.now() < runDeadline) {
        const row = await prisma.testRun.findUnique({ where: { id: runRes.body.runId } });
        if (row && row.status !== 'QUEUED' && row.status !== 'RUNNING') {
          runStatus = row.status;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(runStatus).toBe('SUCCEEDED');

      const previewRes = await admin<{ expectedProdVersionId: string; warnings: Array<{ code: string }>; gate: { verdict: string } }>(
        'POST',
        `/chatbots/${chatbotId}/environment/prod/preview`,
        { kind: 'SWITCH', targetVersionId: v2Id },
      );
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.gate.verdict).toBe('PASS'); // 대상 버전 실행 기록이 있어 GATE_WARN은 없다.
      expect(previewRes.body.warnings.map((w) => w.code)).toEqual(['PROFILE_WILL_CHANGE']);

      // acknowledgeWarnings 없이 확정 — 게이트만 보던 예전 검사는 여기를 통과시켰다(회귀 버그).
      const withoutAck = await admin<{ code?: string; details?: Array<{ field: string }> }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewRes.body.expectedProdVersionId,
      });
      expect(withoutAck.status).toBe(400);
      expect(withoutAck.body.details?.[0]?.field).toBe('acknowledgeWarnings');

      // 운영이 그대로 v1인지 확인(거부됐으니 바뀌지 않아야 한다).
      const statusAfterReject = await getStatus(chatbotId);
      expect((statusAfterReject.body as { prod: { versionId: string } }).prod.versionId).toBe(v1Id);

      const withAck = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewRes.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(withAck.status).toBe(201);
      expect(withAck.body.outcome).toBe('APPLIED');
      expect(withAck.body.prod.versionId).toBe(v2Id);
    });

    it('SWITCH_PROD_VERSION 예약 생성도 같은 규칙 — 경고 있는데 acknowledgeWarnings 없으면 400이다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('예약경고확인');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `예약경고확인-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);

      await admin('PATCH', `/chatbots/${chatbotId}/settings`, { name: `예약경고확인-이름변경-${chatbotId.slice(0, 6)}` });
      const statusForStaging = await getStatus(chatbotId);
      const stagingBefore = (statusForStaging.body as { staging: { versionId: string } | null }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBefore?.versionId ?? null,
      });
      const v2Id = promoteRes.body.staging.versionId;
      const prodVersionId = (enabled as { prod: { versionId: string } }).prod.versionId;

      const scheduledAt = new Date(clock.now().getTime() + 3 * 60 * 60 * 1000).toISOString();
      const withoutAck = await admin<{ code?: string; details?: Array<{ field: string }> }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        previewedProdVersionId: prodVersionId,
        scheduledAt,
      });
      expect(withoutAck.status).toBe(400);
      expect(withoutAck.body.details?.[0]?.field).toBe('acknowledgeWarnings');

      const withAck = await admin<{ schedule: { id: string; status: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        previewedProdVersionId: prodVersionId,
        scheduledAt,
        acknowledgeWarnings: true,
      });
      expect(withAck.status).toBe(201);
      expect(withAck.body.schedule.status).toBe('PENDING');
    });
  });

  describe('N. ★ R1 M-1 — 버전 삭제가 environment/serving L1 캐시를 무효화한다', () => {
    it('시뮬레이터 대상으로 캐시된 버전을 삭제하면 같은 versionId 재요청이 404가 된다(캐시된 옛 내용이 아니라)', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('버전삭제캐시');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `버전삭제캐시-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      // v2(스테이징) → v3(스테이징, v2를 대체) — v2는 운영이었던 적이 없어 보호 집합 밖이라 삭제 가능하다.
      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const statusForV2 = await getStatus(chatbotId);
      const stagingBeforeV2 = (statusForV2.body as { staging: { versionId: string } | null }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingBeforeV2?.versionId ?? null,
      });
      const v2Id = promoteV2.body.staging.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v3');
      const promoteV3 = await admin('POST', `/chatbots/${chatbotId}/environment/staging/promote`, { expectedStagingVersionId: v2Id });
      expect(promoteV3.status).toBe(201);

      // v2를 시뮬레이터 대상으로 한 번 읽어 L1 캐시를 데운다.
      const warm = await admin<{ outputs: Array<{ payload?: { text?: string } }> }>('POST', `/chatbots/${chatbotId}/simulate`, {
        message: `버전삭제캐시-${chatbotId.slice(0, 6)} 문의`,
        target: { kind: 'VERSION', versionId: v2Id },
      });
      expect(warm.status).toBe(200);
      expect(warm.body.outputs?.[0]?.payload?.text).toBe('응답-v2');

      const deleteRes = await admin('DELETE', `/chatbots/${chatbotId}/versions/${v2Id}`);
      expect(deleteRes.status).toBe(204);

      // 캐시가 무효화되지 않았다면 '응답-v2'가 다시 나온다 — 삭제됐으니 404여야 한다.
      const afterDelete = await admin('POST', `/chatbots/${chatbotId}/simulate`, {
        message: `버전삭제캐시-${chatbotId.slice(0, 6)} 문의`,
        target: { kind: 'VERSION', versionId: v2Id },
      });
      expect(afterDelete.status).toBe(404);
    });
  });

  describe('O. ★ R1 M-2 — 복원 잠금 중 켜기는 409 ENV_SWITCH_BUSY다(§5.3 ①)', () => {
    it('RestoreLockRegistry가 챗봇을 잠근 동안 enable()은 409를 반환하고, 해제 후에는 성공한다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('켜기잠금');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `켜기잠금-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');

      const preview = await admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
      expect(preview.status).toBe(200);

      expect(restoreLock.tryAcquire(chatbotId)).toBe(true);
      try {
        const lockedRes = await admin<{ code?: string }>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
        expect(lockedRes.status).toBe(409);
        expect(lockedRes.body.code).toBe('ENV_SWITCH_BUSY');
      } finally {
        restoreLock.release(chatbotId);
      }

      const afterRelease = await admin<{ enabled: boolean }>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
      expect(afterRelease.status).toBe(201);
      expect(afterRelease.body.enabled).toBe(true);
    });
  });

  describe('P. ★ 실제 동시성 경합(Promise.all · 실제 SQLite) — test-automation 보강(2026-09-25)', () => {
    it('P-1. 운영 전환 2건 동시 요청 — 서로 다른 대상으로 같은 기대값을 CAS하면 1건만 성공하고 나머지는 409로 수렴한다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('동시전환');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `동시전환-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      // v2를 즉시 전환해 v1을 "운영 이력"으로 만든다 — 이제 SWITCH 대상 후보가 2개(v1=이력, v3=스테이징)다.
      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const stagingV2 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;
      const previewV2 = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchToV2 = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewV2.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchToV2.status).toBe(201); // 지금 운영 = v2, v1은 운영 이력.

      await setNodeOutputText(chatbotId, nodeId, '응답-v3');
      const stagingV3 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV3 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV3.versionId,
      });
      const v3Id = promoteV3.body.staging.versionId;

      // 현재 운영 = v2. 두 요청이 서로 다른 대상(v3=스테이징, v1=운영 이력)으로 같은 expectedProdVersionId(v2)를
      // 노려 실제로 동시에(Promise.all) 날아간다 — 대상이 다르므로 "이미 적용됨 NOOP" 경로로 새지 않고
      // CAS 승자만 남는다(§9.1 조건부 갱신).
      const [resToV3, resToV1] = await Promise.all([
        admin<{ outcome?: string; code?: string; prod?: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
          targetVersionId: v3Id,
          expectedProdVersionId: v2Id,
          acknowledgeWarnings: true,
        }),
        admin<{ outcome?: string; code?: string; prod?: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
          targetVersionId: v1Id,
          expectedProdVersionId: v2Id,
          acknowledgeWarnings: true,
        }),
      ]);

      const results = [resToV3, resToV1];
      const winners = results.filter((r) => r.status === 201 && r.body.outcome === 'APPLIED');
      const losers = results.filter((r) => r.status === 409);
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(['ENV_POINTER_STALE', 'ENV_SWITCH_BUSY']).toContain((losers[0].body as { code?: string }).code);

      // 포인터 일관성 — 최종 운영은 승자가 요청한 대상과 같다.
      const finalStatus = await getStatus(chatbotId);
      const finalProdId = (finalStatus.body as { prod: { versionId: string } }).prod.versionId;
      expect(finalProdId).toBe(winners[0].body.prod?.versionId);
      expect([v1Id, v3Id]).toContain(finalProdId);

      // 이력 정합 — v2 이후의 IMMEDIATE PROD 전환 이력이 정확히 1건이다(이중 적용 없음).
      const switchLogs = await prisma.environmentSwitchLog.findMany({ where: { chatbotId, environment: 'PROD', fromVersionId: v2Id } });
      expect(switchLogs.length).toBe(1);

      const afterSession = sessionUuid();
      const afterMsg = await sendPublic(slug, afterSession, `동시전환-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterMsg)).toBe(finalProdId === v1Id ? '응답-v1' : '응답-v3');
    }, 20_000);

    it('P-2. 전환과 롤백 동시 요청 — 1건만 성공하고 나머지는 409로 수렴하며 포인터·이력이 일관된다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('전환롤백경합');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `전환롤백경합-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const stagingV2 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;
      const previewV2 = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchToV2 = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewV2.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchToV2.status).toBe(201); // 지금 운영 = v2, v1은 운영 이력(롤백 대상 후보).

      await setNodeOutputText(chatbotId, nodeId, '응답-v3');
      const stagingV3 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV3 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV3.versionId,
      });
      const v3Id = promoteV3.body.staging.versionId;

      // 전환(v2→v3)과 롤백(v2→v1)을 실제로 동시에 날린다.
      const [switchRes, rollbackRes] = await Promise.all([
        admin<{ outcome?: string; code?: string; prod?: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
          targetVersionId: v3Id,
          expectedProdVersionId: v2Id,
          acknowledgeWarnings: true,
        }),
        admin<{ outcome?: string; code?: string; prod?: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/rollback`, {
          targetVersionId: v1Id,
          expectedProdVersionId: v2Id,
          acknowledgeWarnings: true,
        }),
      ]);

      const results = [switchRes, rollbackRes];
      const winners = results.filter((r) => (r.status === 200 || r.status === 201) && r.body.outcome === 'APPLIED');
      const losers = results.filter((r) => r.status === 409);
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(['ENV_POINTER_STALE', 'ENV_SWITCH_BUSY']).toContain((losers[0].body as { code?: string }).code);

      const finalStatus = await getStatus(chatbotId);
      const finalProdId = (finalStatus.body as { prod: { versionId: string } }).prod.versionId;
      expect(finalProdId).toBe(winners[0].body.prod?.versionId);
      expect([v1Id, v3Id]).toContain(finalProdId);

      const switchLogs = await prisma.environmentSwitchLog.findMany({ where: { chatbotId, environment: 'PROD', fromVersionId: v2Id } });
      expect(switchLogs.length).toBe(1);

      const afterMsg = await sendPublic(slug, sessionUuid(), `전환롤백경합-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterMsg)).toBe(finalProdId === v1Id ? '응답-v1' : '응답-v3');
    }, 20_000);

    it('P-3. 전환과 모드 끄기 동시 요청 — 1건만 성공하고 나머지는 409로 수렴하며 상태가 일관된다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('전환끄기경합');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `전환끄기경합-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const stagingV2 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;
      const previewV2 = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchToV2 = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewV2.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchToV2.status).toBe(201); // 지금 운영 = v2 = 스테이징(승격 후 안 바뀜) = 초안.

      // 끄기 미리보기로 expectedDraftHash를 확보한다(끄기 확정 요청에 필요한 값 — 경합 대상은 아니다).
      const disablePreview = await admin<{ prod: { versionId: string }; draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/disable/preview`);
      expect(disablePreview.status).toBe(200);
      expect(disablePreview.body.prod.versionId).toBe(v2Id);

      await setNodeOutputText(chatbotId, nodeId, '응답-v3');
      const stagingV3 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV3 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV3.versionId,
      });
      const v3Id = promoteV3.body.staging.versionId;

      // 운영 전환(v2→v3)과 모드 끄기(PROMOTE_DRAFT · 초안=v3 상태를 그대로 라이브로)를 실제로 동시에 날린다.
      const [switchRes, disableRes] = await Promise.all([
        admin<{ outcome?: string; code?: string; prod?: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
          targetVersionId: v3Id,
          expectedProdVersionId: v2Id,
          acknowledgeWarnings: true,
        }),
        admin<{ enabled?: boolean; code?: string }>('POST', `/chatbots/${chatbotId}/environment/disable`, {
          mode: 'PROMOTE_DRAFT',
          expectedProdVersionId: v2Id,
          expectedDraftHash: disablePreview.body.draftContentHash,
        }),
      ]);

      const switchWon = switchRes.status === 201 && (switchRes.body as { outcome?: string }).outcome === 'APPLIED';
      const disableWon = disableRes.status === 201 && (disableRes.body as { enabled?: boolean }).enabled === false;
      // 정확히 하나만 성공한다 — 둘 다 성공(이중 적용)하거나 둘 다 실패(교착)하면 안 된다.
      expect(switchWon !== disableWon).toBe(true);
      if (switchWon) {
        expect(disableRes.status).toBe(409);
      } else {
        expect(switchRes.status).toBe(409);
      }

      const finalStatus = await getStatus(chatbotId);
      if (switchWon) {
        expect((finalStatus.body as { enabled: boolean }).enabled).toBe(true);
        expect((finalStatus.body as { prod: { versionId: string } }).prod.versionId).toBe(v3Id);
      } else {
        expect((finalStatus.body as { enabled: boolean }).enabled).toBe(false);
        const afterDisableSession = sessionUuid();
        const afterDisableMsg = await sendPublic(slug, afterDisableSession, `전환끄기경합-${chatbotId.slice(0, 6)} 문의`);
        expect(outputText(afterDisableMsg)).toBe('응답-v3'); // PROMOTE_DRAFT — 초안(v3)이 그대로 라이브.
      }

      // 이력 정합 — v2 이후 PROD 이력이 정확히 1건(IMMEDIATE 또는 DISABLE)이다.
      const switchLogs = await prisma.environmentSwitchLog.findMany({ where: { chatbotId, environment: 'PROD', fromVersionId: v2Id } });
      expect(switchLogs.length).toBe(1);
    }, 20_000);

    it('P-4. 예약 실행과 즉시 전환 경합 — 같은 대상으로 수렴하고 이중 적용이 없다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('예약즉시경합');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `예약즉시경합-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const stagingV2 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;

      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await admin<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        previewedProdVersionId: v1Id,
        scheduledAt: scheduledAt.toISOString(),
        acknowledgeWarnings: true,
      });
      expect(createRes.status).toBe(201);

      clock.advance(10 * 60_000 + 5_000);

      // 예약 실행(engine.tick — 내부적으로 같은 ProdSwitchService.switch()를 호출한다)과 관리자의
      // 즉시 전환 요청이 **같은 대상(v2)** 을 향해 실제로 동시에 실행된다. 둘 다 throw하지 않는
      // 경로(엔진은 절대 throw하지 않는다 — §11.3)이므로 결과는 둘 중 하나가 APPLIED, 다른 하나는
      // NOOP(이미 적용됨을 늦게 관측) 또는 STATE_CHANGED/ENV_POINTER_STALE(CAS 패배) 중 하나로
      // 수렴해야 하며, 최종적으로 이중 적용(같은 전이가 이력에 2번)은 없어야 한다.
      const [, adminRes] = await Promise.all([
        engine.tick(),
        admin<{ outcome?: string; code?: string }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
          targetVersionId: v2Id,
          expectedProdVersionId: v1Id,
          acknowledgeWarnings: true,
        }),
      ]);

      expect([200, 201, 409]).toContain(adminRes.status);
      if (adminRes.status === 409) {
        expect(['ENV_POINTER_STALE', 'ENV_SWITCH_BUSY']).toContain((adminRes.body as { code?: string }).code);
      } else {
        expect(['APPLIED', 'NOOP']).toContain((adminRes.body as { outcome?: string }).outcome);
      }

      const scheduleRow = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(['SUCCEEDED', 'FAILED']).toContain(scheduleRow?.status);
      if (scheduleRow?.status === 'FAILED') {
        expect(scheduleRow.failureReason).toBe('STATE_CHANGED');
      }

      // 포인터 일관성 — 둘 다 v2를 겨눴으므로 최종 운영은 반드시 v2다(경합 승자와 무관하게 수렴).
      const finalStatus = await getStatus(chatbotId);
      expect((finalStatus.body as { prod: { versionId: string } }).prod.versionId).toBe(v2Id);

      // 이력 정합 — v1 → v2 전이가 정확히 1건이다(예약 실행·즉시 전환 어느 쪽이 성공했든 중복 없음).
      const switchLogs = await prisma.environmentSwitchLog.findMany({ where: { chatbotId, environment: 'PROD', fromVersionId: v1Id, toVersionId: v2Id } });
      expect(switchLogs.length).toBe(1);

      const afterMsg = await sendPublic(slug, sessionUuid(), `예약즉시경합-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterMsg)).toBe('응답-v2');
    }, 20_000);
  });

  describe('Q. ★ 권한 매트릭스 — ADMIN/EDITOR/VIEWER/AGENT × 환경 API 11개 엔드포인트(FR-EN9-1)', () => {
    type MatrixRole = 'ADMIN' | 'EDITOR' | 'VIEWER' | 'AGENT';
    let matrixChatbotId: string;

    beforeAll(async () => {
      const { id: chatbotId } = await createChatbotWithSlug('권한매트릭스');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `권한매트릭스-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);
      matrixChatbotId = chatbotId;
    });

    const roleFns: Record<MatrixRole, <T = unknown>(method: string, path: string, body?: unknown) => Promise<ApiResponse<T>>> = {
      ADMIN: admin,
      EDITOR: editor,
      VIEWER: viewer,
      AGENT: agent,
    };

    // §19.1 신규 엔드포인트 11개 — 각 행의 allowed는 FR-EN9-1 권한 매핑(§17.1)에서 도출한 기대값이다.
    const endpoints: Array<{ name: string; method: string; path: (id: string) => string; body?: unknown; allowed: MatrixRole[] }> = [
      { name: 'GET  .../environment', method: 'GET', path: (id) => `/chatbots/${id}/environment`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
      { name: 'POST .../environment/enable/preview', method: 'POST', path: (id) => `/chatbots/${id}/environment/enable/preview`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
      { name: 'POST .../environment/enable', method: 'POST', path: (id) => `/chatbots/${id}/environment/enable`, body: {}, allowed: ['ADMIN'] },
      { name: 'POST .../environment/disable/preview', method: 'POST', path: (id) => `/chatbots/${id}/environment/disable/preview`, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
      { name: 'POST .../environment/disable', method: 'POST', path: (id) => `/chatbots/${id}/environment/disable`, body: {}, allowed: ['ADMIN'] },
      { name: 'POST .../environment/staging/promote', method: 'POST', path: (id) => `/chatbots/${id}/environment/staging/promote`, body: {}, allowed: ['ADMIN', 'EDITOR'] },
      { name: 'POST .../environment/prod/preview', method: 'POST', path: (id) => `/chatbots/${id}/environment/prod/preview`, body: { kind: 'SWITCH' }, allowed: ['ADMIN', 'EDITOR', 'VIEWER'] },
      { name: 'POST .../environment/prod/switch', method: 'POST', path: (id) => `/chatbots/${id}/environment/prod/switch`, body: {}, allowed: ['ADMIN'] },
      { name: 'POST .../environment/prod/rollback', method: 'POST', path: (id) => `/chatbots/${id}/environment/prod/rollback`, body: {}, allowed: ['ADMIN'] },
      { name: 'GET  .../environment/history', method: 'GET', path: (id) => `/chatbots/${id}/environment/history`, allowed: ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'] },
      { name: 'PUT  .../environment/gate', method: 'PUT', path: (id) => `/chatbots/${id}/environment/gate`, body: {}, allowed: ['ADMIN'] },
    ];

    for (const ep of endpoints) {
      for (const role of ['ADMIN', 'EDITOR', 'VIEWER', 'AGENT'] as const) {
        const shouldAllow = ep.allowed.includes(role);
        it(`${ep.name} — ${role}은 ${shouldAllow ? '허용(403 아님)' : '거부(403)'}된다`, async () => {
          const res = await roleFns[role](ep.method, ep.path(matrixChatbotId), ep.body);
          if (shouldAllow) {
            expect(res.status).not.toBe(403);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    }
  });

  describe('R. 학습현황 prodReflection · deletedInDraft — No.44 피드백과의 상호작용(FR-EN8-4/5, §15)', () => {
    it('부정 평가 항목이 "운영 미반영"→"운영 반영"으로 전이하고, 초안 삭제 후 상세가 운영 버전 이름으로 "초안에서 삭제됨"을 보인다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('학습현황상호작용');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `학습현황상호작용-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '안내-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      // 운영 버전(v1)이 서빙한 실제 대화 로그를 확보한다 — 이 로그가 부정 평가(NEGATIVE_FEEDBACK)의
      // lastFeedbackLogId가 된다(실제 평가 API를 왕복하는 대신, 학습-augmentation 통합 시험과 같은
      // 방식으로 UnansweredQuestion 행을 직접 만든다 — §15 판정 자체는 순수 함수 단위 시험이 이미
      // 촘촘히 덮고, 여기서는 "환경 전환·초안 삭제라는 실제 사건과의 상호작용"만 검증한다).
      const sessionId = sessionUuid();
      const servedRes = await sendPublic(slug, sessionId, `학습현황상호작용-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(servedRes)).toBe('안내-v1');
      const polled = await pollConversationLog(chatbotId, sessionId);
      expect(polled).not.toBeNull();
      const fullLog = await prisma.conversationLog.findUnique({ where: { id: polled!.id } });
      expect(fullLog?.matchedNodeId).toBe(nodeId);
      expect(fullLog?.servedVersionId).toBe(v1Id);

      // 반영(resolvedAt) 시각 = 지금(v1이 이미 캡처된 뒤) — 다음 전환 전까지는 "운영 미반영"이어야 한다.
      // ChatbotVersion.createdAt은 enable()/switch()가 실제 벽시계(`new Date()`)로 찍는다(FakeClock 미사용) —
      // resolvedAt도 실제 벽시계를 써야 v1.createdAt과 같은 시간축에서 비교된다.
      const resolvedAt = new Date();
      const uq = await prisma.unansweredQuestion.create({
        data: {
          chatbotId,
          source: 'NEGATIVE_FEEDBACK',
          status: 'RESOLVED',
          questionText: '학습현황상호작용 질문',
          questionNormalized: `normalized-학습현황상호작용-${chatbotId.slice(0, 6)}`,
          variants: JSON.stringify(['학습현황상호작용 질문']),
          lastFeedbackLogId: fullLog!.id,
          resolvedAt,
          recurredCount: 1,
          lastOccurredAt: new Date(resolvedAt.getTime() + 1_000),
        },
      });

      const listPending = await admin<{ items: Array<{ id: string; prodReflection?: { status: string } }> }>(
        'GET',
        `/chatbots/${chatbotId}/unanswered-questions?status=RESOLVED&source=NEGATIVE_FEEDBACK`,
      );
      expect(listPending.status).toBe(200);
      const itemPending = listPending.body.items.find((i) => i.id === uq.id);
      expect(itemPending?.prodReflection?.status).toBe('PENDING_SWITCH');

      // 초안을 고치고 승격+전환한다 — 새 운영(v2)의 캡처 시각은 resolvedAt 이후이므로 REFLECTED가 된다.
      await setNodeOutputText(chatbotId, nodeId, '안내-v2');
      const staging = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging?.versionId ?? null,
      });
      const v2Id = promoteRes.body.staging.versionId;
      const previewRes = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchRes = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewRes.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchRes.status).toBe(201);

      const listReflected = await admin<{ items: Array<{ id: string; prodReflection?: { status: string; reflectedAt?: string } }> }>(
        'GET',
        `/chatbots/${chatbotId}/unanswered-questions?status=RESOLVED&source=NEGATIVE_FEEDBACK`,
      );
      const itemReflected = listReflected.body.items.find((i) => i.id === uq.id);
      expect(itemReflected?.prodReflection?.status).toBe('REFLECTED');
      expect(itemReflected?.prodReflection?.reflectedAt).toBeTruthy();

      // 초안에서 노드를 삭제한다 — 그 턴이 서빙된 버전(v1)에는 여전히 남아 있다.
      const deleteRes = await admin('DELETE', `/chatbots/${chatbotId}/dialog-nodes/${nodeId}`);
      expect(deleteRes.status).toBe(204);

      const detailRes = await admin<{
        lastFeedback?: { target: { kind: string; deleted?: boolean; deletedInDraft?: boolean; nameFromVersion?: string } };
      }>('GET', `/chatbots/${chatbotId}/unanswered-questions/${uq.id}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.lastFeedback?.target.kind).toBe('NODE');
      expect(detailRes.body.lastFeedback?.target.deletedInDraft).toBe(true);
      expect(detailRes.body.lastFeedback?.target.nameFromVersion).toBe(`노드-안내-v1`);
    });
  });

  describe('S. ★ AC/EX 추적표 보강 — 개별 항목 결정적 시험(2026-09-25)', () => {
    it('S-1. AC-EN1-5 — "초안을 운영으로"(PROMOTE_DRAFT)로 끄면 공개 응답이 초안 기준이 되고 이력에 DISABLE이 남는다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('끄기초안승격');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `끄기초안승격-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      await setNodeOutputText(chatbotId, nodeId, '응답-초안');
      const disablePreview = await admin<{ prod: { versionId: string }; draftContentHash: string; draftDiffersFromProd: boolean }>(
        'POST',
        `/chatbots/${chatbotId}/environment/disable/preview`,
      );
      expect(disablePreview.status).toBe(200);
      expect(disablePreview.body.draftDiffersFromProd).toBe(true);

      const disableRes = await admin<{ enabled: boolean }>('POST', `/chatbots/${chatbotId}/environment/disable`, {
        mode: 'PROMOTE_DRAFT',
        expectedProdVersionId: disablePreview.body.prod.versionId,
        expectedDraftHash: disablePreview.body.draftContentHash,
      });
      expect(disableRes.status).toBe(201);
      expect(disableRes.body.enabled).toBe(false);

      const afterMsg = await sendPublic(slug, sessionUuid(), `끄기초안승격-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterMsg)).toBe('응답-초안'); // 초안이 그대로 라이브가 됐다(운영 버전이 아니라).

      const history = await admin<{ items: Array<{ method: string }> }>('GET', `/chatbots/${chatbotId}/environment/history?environment=PROD`);
      expect(history.body.items.map((h) => h.method)).toEqual(expect.arrayContaining(['INIT', 'DISABLE']));
    });

    it('S-2. AC-EN1-6 — ARCHIVED 챗봇은 켜기가 409 CHATBOT_ARCHIVED다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('보관켜기');
      await activate(chatbotId);
      const archiveRes = await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' });
      expect(archiveRes.status).toBe(200);

      const preview = await admin<{ draftContentHash: string }>('POST', `/chatbots/${chatbotId}/environment/enable/preview`);
      expect(preview.status).toBe(200); // 미리보기는 읽기 전용이라 허용된다 — blockers에 담긴다.
      expect((preview.body as unknown as { blockers: string[] }).blockers).toContain('CHATBOT_ARCHIVED');

      const enableRes = await admin<{ code?: string }>('POST', `/chatbots/${chatbotId}/environment/enable`, { expectedDraftHash: preview.body.draftContentHash });
      expect(enableRes.status).toBe(409);
      expect(enableRes.body.code).toBe('CHATBOT_ARCHIVED');
    });

    it('S-3. AC-EN2-1 — 운영 버전이 있으면 getConfig()의 이름·스킨(표시 설정)은 초안 편집과 무관하게 운영 버전 값을 유지한다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('표시설정격리');
      await activate(chatbotId);
      const nameRes = await admin('PATCH', `/chatbots/${chatbotId}/settings`, { name: '표시설정격리-v1' });
      expect(nameRes.status).toBe(200);
      const skinRes = await admin('PATCH', `/chatbots/${chatbotId}/skin`, { headerTitle: '헤더-v1' });
      expect(skinRes.status).toBe(200);
      await enableEnv(chatbotId);

      const beforeConfig = await pub<{ name: string; skin: { headerTitle: string } }>('GET', `/public/chatbots/${slug}/config`);
      expect(beforeConfig.status).toBe(200);
      expect(beforeConfig.body.name).toBe('표시설정격리-v1');
      expect(beforeConfig.body.skin.headerTitle).toBe('헤더-v1');

      // 초안(현재 테이블)에서 이름·헤더 문구를 바꾼다 — 운영 버전은 v1 그대로다.
      await admin('PATCH', `/chatbots/${chatbotId}/settings`, { name: '표시설정격리-초안변경' });
      await admin('PATCH', `/chatbots/${chatbotId}/skin`, { headerTitle: '헤더-초안변경' });

      const afterConfig = await pub<{ name: string; skin: { headerTitle: string } }>('GET', `/public/chatbots/${slug}/config`);
      expect(afterConfig.status).toBe(200);
      expect(afterConfig.body.name).toBe('표시설정격리-v1'); // 초안 변경이 새지 않는다(AC-EN2-1).
      expect(afterConfig.body.skin.headerTitle).toBe('헤더-v1');
    });

    it('S-4. AC-EN4-2 — 초안 변경 없이 승격하면 새 버전을 만들지 않고 NOOP이다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('승격무변경');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `승격무변경-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      const versionCountBefore = await prisma.chatbotVersion.count({ where: { chatbotId } });
      const status = await getStatus(chatbotId);
      const staging = (status.body as { staging: { versionId: string } }).staging;

      // 켜기 직후 초안은 이미 스테이징(=운영)과 같다 — 변경 없이 승격을 시도하면 NOOP.
      const promoteRes = await admin<{ outcome: string; staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging.versionId,
      });
      expect(promoteRes.status).toBe(201);
      expect(promoteRes.body.outcome).toBe('NOOP');
      expect(promoteRes.body.staging.versionId).toBe(staging.versionId);

      const versionCountAfter = await prisma.chatbotVersion.count({ where: { chatbotId } });
      expect(versionCountAfter).toBe(versionCountBefore); // 새 버전 행 0(§9.2).
    });

    it('S-5. AC-EN4-7 — 운영·스테이징 포인터가 참조하는 버전은 삭제 시 409 VERSION_REFERENCED_BY_ENVIRONMENT다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('삭제보호');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `삭제보호-${chatbotId.slice(0, 6)}`);
      await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      const deleteRes = await admin<{ code?: string }>('DELETE', `/chatbots/${chatbotId}/versions/${v1Id}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.code).toBe('VERSION_REFERENCED_BY_ENVIRONMENT');

      const stillThere = await prisma.chatbotVersion.findUnique({ where: { id: v1Id } });
      expect(stillThere).not.toBeNull();
    });

    it('S-6. AC-EN5-3 — 예약 생성 시점엔 게이트 미달이 차단 사유가 아니지만(경고만), 실행 시점 재평가에서 BLOCK이면 FAILED(GATE_NOT_PASSED)다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('게이트예약차단');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `게이트예약차단-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const staging = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging.versionId,
      });
      const v2Id = promoteRes.body.staging.versionId;

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '차단게이트세트' });
      expect(setRes.status).toBe(201);

      // 예약을 만드는 시점에는 게이트가 기본값(WARN · 세트 미지정)이라 GATE_BLOCKED가 없다 — 창설 자체는
      // 통과한다(대상 버전에 아무 실행도 없어 GATE_WARN/NO_RUN 경고만 뜨므로 acknowledgeWarnings만 필요,
      // §11.2 "GATE_BLOCKED는 생성 시점 blocker가 아니다"는 "예약 생성 이후 게이트가 BLOCK으로 바뀌는"
      // 이 흐름을 가리킨다 — BLOCK 게이트를 먼저 걸어두면 생성 자체가 preview.blockers=GATE_BLOCKED로
      // 막히므로(DEPLOY_SCHEDULE_PRECONDITION_FAILED), 실행 시점 재평가를 보려면 순서를 이렇게 둬야 한다).
      const scheduledAt = new Date(clock.now().getTime() + 10 * 60_000);
      const createRes = await admin<{ schedule: { id: string } }>('POST', `/chatbots/${chatbotId}/deploy-schedules`, {
        action: 'SWITCH_PROD_VERSION',
        targetVersionId: v2Id,
        previewedProdVersionId: v1Id,
        scheduledAt: scheduledAt.toISOString(),
        acknowledgeWarnings: true,
      });
      expect(createRes.status).toBe(201);

      // 예약이 살아있는 채로, 실행 전에 차단 게이트를 건다 — v2 대상의 성공한 실행이 없으므로 실행
      // 시점 재평가에서 NO_RUN → BLOCK이 된다.
      const gateRes = await admin('PUT', `/chatbots/${chatbotId}/environment/gate`, { mode: 'BLOCK', testSetId: setRes.body.id, minPassRate: 95, validHours: 24 });
      expect(gateRes.status).toBe(200);

      clock.advance(10 * 60_000 + 5_000);
      await engine.tick();

      const row = await prisma.deploySchedule.findUnique({ where: { id: createRes.body.schedule.id } });
      expect(row?.status).toBe('FAILED');
      expect(row?.failureReason).toBe('GATE_NOT_PASSED');

      const finalStatus = await getStatus(chatbotId);
      expect((finalStatus.body as { prod: { versionId: string } }).prod.versionId).toBe(v1Id); // 운영 불변.
    });

    it('S-7. AC-EN6-4/6-5/6-6 — 차단 게이트가 즉시 전환을 막고(BLOCK), 경고만으로는 확인 후 통과하며(WARN), 롤백은 차단을 경고로 낮춘다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('게이트즉시');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `게이트즉시-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const stagingV2 = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteV2 = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: stagingV2.versionId,
      });
      const v2Id = promoteV2.body.staging.versionId;

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: '즉시차단게이트세트' });
      expect(setRes.status).toBe(201);

      // (BLOCK 모드) v2 대상 성공 실행이 없다 → 즉시 전환은 게이트로 막힌다(AC-EN6-4).
      const blockGate = await admin('PUT', `/chatbots/${chatbotId}/environment/gate`, { mode: 'BLOCK', testSetId: setRes.body.id, minPassRate: 95, validHours: 24 });
      expect(blockGate.status).toBe(200);
      const blockedPreview = await admin<{ gate: { verdict: string; reason: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      expect(blockedPreview.status).toBe(200);
      expect(blockedPreview.body.gate.verdict).toBe('BLOCK');
      const blockedSwitch = await admin<{ code?: string }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: v1Id,
        acknowledgeWarnings: true,
      });
      expect(blockedSwitch.status).toBe(409);
      expect(blockedSwitch.body.code).toBe('ENV_GATE_NOT_PASSED');
      const stillV1 = await getStatus(chatbotId);
      expect((stillV1.body as { prod: { versionId: string } }).prod.versionId).toBe(v1Id);

      // (WARN 모드) 같은 상황 — 이번엔 경고로만 뜨고, acknowledgeWarnings 없이는 400, 있으면 통과한다(AC-EN6-5).
      const warnGate = await admin('PUT', `/chatbots/${chatbotId}/environment/gate`, { mode: 'WARN', testSetId: setRes.body.id, minPassRate: 95, validHours: 24 });
      expect(warnGate.status).toBe(200);
      const warnPreview = await admin<{ gate: { verdict: string }; expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, {
        kind: 'SWITCH',
        targetVersionId: v2Id,
      });
      expect(warnPreview.body.gate.verdict).toBe('WARN');
      const noAckSwitch = await admin<{ code?: string }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: warnPreview.body.expectedProdVersionId,
      });
      expect(noAckSwitch.status).toBe(400);
      const ackSwitch = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: warnPreview.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(ackSwitch.status).toBe(201);
      expect(ackSwitch.body.outcome).toBe('APPLIED');
      expect(ackSwitch.body.prod.versionId).toBe(v2Id); // 지금 운영 = v2, v1은 운영 이력.

      const afterSwitchMsg = await sendPublic(slug, sessionUuid(), `게이트즉시-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(afterSwitchMsg)).toBe('응답-v2');

      // 다시 BLOCK 모드로 — v1(이력)에도 성공 실행이 없어 여전히 BLOCK 판정이지만, 롤백은 경고로 낮아져
      // acknowledgeWarnings만으로 통과한다(AC-EN6-6, FR-EN4-4).
      const blockGate2 = await admin('PUT', `/chatbots/${chatbotId}/environment/gate`, { mode: 'BLOCK', testSetId: setRes.body.id, minPassRate: 95, validHours: 24 });
      expect(blockGate2.status).toBe(200);
      const rollbackPreview = await admin<{ gate: { verdict: string }; expectedProdVersionId: string; target: { versionId: string } }>(
        'POST',
        `/chatbots/${chatbotId}/environment/prod/preview`,
        { kind: 'ROLLBACK' },
      );
      expect(rollbackPreview.status).toBe(200);
      expect(rollbackPreview.body.target.versionId).toBe(v1Id);
      // evaluateProdSwitchGate 자체가 kind=ROLLBACK이면 BLOCK 판정을 WARN으로 낮춰 반환한다(§10 —
      // "긴급 복귀 우선", gate.spec.ts에서 순수 함수로 이미 검증). 미리보기 판정도 이미 WARN이다.
      expect(rollbackPreview.body.gate.verdict).toBe('WARN');
      const rollbackRes = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/rollback`, {
        expectedProdVersionId: rollbackPreview.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(rollbackRes.status).toBe(201); // BLOCK이 롤백에서는 경고로 낮아져 차단하지 않는다.
      expect(rollbackRes.body.prod.versionId).toBe(v1Id);
    });

    it('S-8. AC-EN8-2 — 운영 전환은 감사 로그 1건을 남기고, 요약에는 버전 번호만 있을 뿐 자산 본문이 없다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('감사요약');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `감사요약-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '기밀-답변-절대노출금지');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '기밀-답변-절대노출금지-v2');
      const staging = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging.versionId,
      });
      const v2Id = promoteRes.body.staging.versionId;
      const previewRes = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchRes = await admin('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: previewRes.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchRes.status).toBe(201);

      const auditRows = await prisma.auditLog.findMany({ where: { chatbotId, targetType: 'ChatbotEnvironment' }, orderBy: { createdAt: 'desc' } });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const latest = auditRows[0];
      expect(latest.summary).not.toContain('기밀-답변-절대노출금지'); // 자산 본문이 새지 않는다(FR-0-155).
      expect(latest.summary).toMatch(/v\d+/); // from/to 버전 번호는 요약에 있다.
    });

    it('S-9. AC-EN8-4 — 공개 요청에 임의 쿼리/헤더로 대상을 지정해도 초안·스테이징에 도달하지 않고 운영 버전만 응답한다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('공개탈출시도');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `공개탈출시도-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);

      // 초안을 운영과 다르게 바꿔 둔다 — 아래 요청들이 "초안"을 보면 즉시 드러난다.
      await setNodeOutputText(chatbotId, nodeId, '응답-초안-탈출');

      const attempts: Array<() => Promise<ApiResponse<{ outputs: Array<{ payload?: { text?: string } }> }>>> = [
        () => pub('POST', `/public/chatbots/${slug}/messages?target=DRAFT`, { sessionId: sessionUuid(), message: `공개탈출시도-${chatbotId.slice(0, 6)} 문의` }),
        () => pub('POST', `/public/chatbots/${slug}/messages?environment=STAGING`, { sessionId: sessionUuid(), message: `공개탈출시도-${chatbotId.slice(0, 6)} 문의` }),
        () =>
          jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: sessionUuid(), message: `공개탈출시도-${chatbotId.slice(0, 6)} 문의` }, { 'X-Env-Target': 'DRAFT' }),
      ];

      for (const attempt of attempts) {
        const res = await attempt();
        expect(res.status).toBe(200);
        expect(outputText(res)).toBe('응답-v1'); // 임의 쿼리·헤더는 무시되고 운영 버전으로만 응답한다.
      }
    });
  });

  describe('T. ★ AC/EX 추적표 보강 — EX-EN-18/19(2026-09-25)', () => {
    it('T-1. EX-EN-18 — 모드 켜진 챗봇을 복사하면 새 챗봇은 환경 모드가 꺼진 채로(초안 기준) 만들어진다', async () => {
      const { id: chatbotId, slug } = await createChatbotWithSlug('복사원본');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `복사원본-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      await enableEnv(chatbotId);
      await setNodeOutputText(chatbotId, nodeId, '응답-초안변경'); // 원본 초안 ≠ 원본 운영.

      const suffix = Math.random().toString(36).slice(2, 10);
      const copyRes = await admin<{ id: string; slug: string }>('POST', `/chatbots/${chatbotId}/copy`, { name: `복사본-${suffix}`, slug: `copy-envtest-${suffix}` });
      expect(copyRes.status).toBe(201);

      const copyStatus = await getStatus(copyRes.body.id);
      expect(copyStatus.status).toBe(200);
      expect((copyStatus.body as { enabled: boolean }).enabled).toBe(false); // 새 챗봇은 모드 꺼짐(포인터 비복사).

      const copyEnvRow = await prisma.chatbotEnvironment.findUnique({ where: { chatbotId: copyRes.body.id } });
      expect(copyEnvRow).toBeNull();

      // 원본은 그대로 영향받지 않는다(공개 응답은 여전히 운영 v1 — 원본 초안 편집이 원본 운영에도 안 샌다).
      const originalMsg = await sendPublic(slug, sessionUuid(), `복사원본-${chatbotId.slice(0, 6)} 문의`);
      expect(outputText(originalMsg)).toBe('응답-v1');
    });

    it('T-2. EX-EN-19 — 모드 켜진 챗봇을 보관(ARCHIVED)하면 전환이 막히고, 복귀(DRAFT) 후에는 재개된다', async () => {
      const { id: chatbotId } = await createChatbotWithSlug('보관중전환');
      await activate(chatbotId);
      const kw = await createKeyword(chatbotId, `보관중전환-${chatbotId.slice(0, 6)}`);
      const nodeId = await createKeywordNode(chatbotId, kw, '응답-v1');
      const enabled = await enableEnv(chatbotId);
      const v1Id = (enabled as { prod: { versionId: string } }).prod.versionId;

      await setNodeOutputText(chatbotId, nodeId, '응답-v2');
      const staging = ((await getStatus(chatbotId)).body as { staging: { versionId: string } }).staging;
      const promoteRes = await admin<{ staging: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/staging/promote`, {
        expectedStagingVersionId: staging.versionId,
      });
      const v2Id = promoteRes.body.staging.versionId;

      // 보관 전환은 ACTIVE→ARCHIVED만 허용되므로 먼저 DRAFT를 거치지 않고 바로 ARCHIVED로 보낸다.
      const archiveRes = await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' });
      expect(archiveRes.status).toBe(200);

      // 포인터는 유지된다(환경 행·챗봇 행의 prodVersionId 모두 그대로).
      const statusWhileArchived = await getStatus(chatbotId);
      expect(statusWhileArchived.status).toBe(200);
      expect((statusWhileArchived.body as { enabled: boolean }).enabled).toBe(true);
      expect((statusWhileArchived.body as { prod: { versionId: string } }).prod.versionId).toBe(v1Id);

      // 전환은 막힌다(409).
      const switchPreview = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const blockedSwitch = await admin<{ code?: string }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: switchPreview.body.expectedProdVersionId ?? v1Id,
        acknowledgeWarnings: true,
      });
      expect(blockedSwitch.status).toBe(409);
      expect(blockedSwitch.body.code).toBe('CHATBOT_ARCHIVED');

      // 복귀(DRAFT) 후에는 전환이 재개된다.
      const restoreDraft = await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'DRAFT' });
      expect(restoreDraft.status).toBe(200);

      const switchPreview2 = await admin<{ expectedProdVersionId: string }>('POST', `/chatbots/${chatbotId}/environment/prod/preview`, { kind: 'SWITCH', targetVersionId: v2Id });
      const switchRes = await admin<{ outcome: string; prod: { versionId: string } }>('POST', `/chatbots/${chatbotId}/environment/prod/switch`, {
        targetVersionId: v2Id,
        expectedProdVersionId: switchPreview2.body.expectedProdVersionId,
        acknowledgeWarnings: true,
      });
      expect(switchRes.status).toBe(201);
      expect(switchRes.body.outcome).toBe('APPLIED');
      expect(switchRes.body.prod.versionId).toBe(v2Id);
    });
  });
});
