import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 토픽 시스템(No.22) 통합 시험 — `docs/requirements/topic-system.md`(AC-TP1~TP7·EX-TP-1~24) ·
 * `docs/02-spec/topic-system-설계.md` §21(시험 설계 포인트)·§21.3(K-1 TC 회귀 절차) 대비.
 * 기존 단위/봉인 시험(`topics/**`·`asset-transfer/**`의 `*.spec.ts`)은 순수 함수·정적 검사를 담당하고,
 * 이 파일은 HTTP 계약 레벨(라우팅·권한·트랜잭션·엔진 통합 동작)을 담당한다(그 전에는 없었다).
 *
 * 임베딩 목 서버(learning-augmentation.integration.spec.ts 선례)를 항상 띄운다 — AC-TP3-2(의미
 * 되묻기 후보 제외)만 쓰지만, `EMBEDDING_BASE_URL`은 정적 `AppModule` import로도 반영된다(그 선례가
 * 이미 증명함 — `ConfigModule.forRoot({validate})` 스냅샷 대상이 아니다).
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제 — 기존 그룹들과 동일한 완화책).
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
}

function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  opts: { cookie?: string; headers?: Record<string, string> } = {},
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
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.headers ?? {}),
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function uploadCsv<T = unknown>(url: string, filename: string, csvContent: string, cookie: string): Promise<ApiResponse<T>> {
  const form = new FormData();
  const blob = new Blob([csvContent], { type: 'text/csv' });
  form.append('file', blob, filename);
  const res = await fetch(url, { method: 'POST', body: form, headers: { Cookie: cookie } });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, headers: {} as http.IncomingHttpHeaders };
}

const BOM = '﻿';
function csv(headers: string[], rows: string[][]): string {
  return BOM + [headers, ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n';
}

/**
 * 임베딩 목 서버(AC-TP3-2 전용) — 텍스트에 포함된 키워드로 결정적 원-핫 벡터를 준다(실제 유사도
 * 계산이 아니라, "비활성 토픽 의도가 벡터상 완전 일치(코사인 1.0)해도 번들 필터 때문에 후보에서
 * 빠진다"를 통제된 조건에서 증명하기 위한 장치). `/embed`·`/health`만 있으면 충분하다
 * (learning-augmentation.integration.spec.ts의 startMockEmbeddingServer와 같은 구조).
 */
function startMockEmbeddingServer(modelId: string, dimension: number): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', modelId, dimension, warmedUp: true }));
        return;
      }
      if (req.method === 'POST' && req.url === '/embed') {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          let texts: string[] = [];
          try {
            texts = (JSON.parse(raw) as { texts?: string[] }).texts ?? [];
          } catch {
            texts = [];
          }
          const vectors = texts.map((t) => {
            const v = new Array(dimension).fill(0);
            if (t.includes('보험금')) v[0] = 1;
            else if (t.includes('환불')) v[1] = 1;
            else if (t.includes('배송')) v[2] = 1;
            else v[dimension - 1] = 1;
            return v;
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ modelId, dimension, vectors }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('토픽 시스템(No.22) 통합 시험', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let embeddingServer: { url: string; close: () => Promise<void> };

  let adminCookie = '';
  let editorCookie = '';
  let viewerCookie = '';
  let agentCookie = '';

  const MODEL_ID = 'topic-itest-embedding-v1';
  const DIMENSION = 4;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-topic-system-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    embeddingServer = await startMockEmbeddingServer(MODEL_ID, DIMENSION);

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = embeddingServer.url;
    process.env.EMBEDDING_TIMEOUT_MS = '5000';

    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
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
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await embeddingServer?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 15_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: adminCookie });
  }
  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: editorCookie });
  }
  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: viewerCookie });
  }
  function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, { cookie: agentCookie });
  }
  function anon<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body);
  }

  /* ----------------------------------------------------------------------------------------
   * 공용 픽스처 빌더
   * ---------------------------------------------------------------------------------------- */

  async function createGroup(name = '토픽시험 그룹'): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${name}-${Math.random().toString(36).slice(2, 8)}` });
    return res.body.id;
  }

  async function createChatbot(overrides: Partial<{ name: string; slug: string; groupId: string }> = {}): Promise<{ id: string; slug: string }> {
    const groupId = overrides.groupId ?? (await createGroup());
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = overrides.slug ?? `ts-itest-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId, name: overrides.name ?? '토픽시험봇', slug });
    return { id: res.body.id, slug };
  }

  async function activateWeb(chatbotId: string, slug: string): Promise<void> {
    const status = await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    expect(status.status).toBe(200);
    const channel = await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, {
      enabled: true,
      config: { allowedOrigins: [], greetingMessage: '무엇을 도와드릴까요?' },
    });
    expect(channel.status).toBe(200);
    void slug;
  }

  async function createTopic(chatbotId: string, body: { name: string; description?: string; enabled?: boolean }): Promise<{ id: string; enabled: boolean; sortOrder: number }> {
    const res = await admin<{ id: string; enabled: boolean; sortOrder: number }>('POST', `/chatbots/${chatbotId}/topics`, body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createIntent(chatbotId: string, body: { name: string; examples?: string[]; topicId?: string | null }): Promise<string> {
    const res = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, body);
    expect(res.status).toBe(201);
    return res.body.intent.id;
  }

  async function createFaq(chatbotId: string, body: { category?: string; question: string; answer: string; topicId?: string | null }): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/faqs`, { category: 'FAQ', ...body });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createKeyword(chatbotId: string, body: { name: string; synonyms?: string[]; topicId?: string | null }): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/keywords`, body);
    return res.status === 201 ? res.body.id : (res.body as unknown as { id: string }).id;
  }

  async function createContext(chatbotId: string, body: { name: string; slots: Array<Record<string, unknown>>; topicId?: string | null }): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/contexts`, body);
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function createNode(
    chatbotId: string,
    body: {
      name: string;
      nodeType?: 'NORMAL' | 'START' | 'FALLBACK';
      intentIds?: string[];
      keywordIds?: string[];
      contextVariableId?: string;
      outputs: Array<Record<string, unknown>>;
      topicId?: string | null;
    },
  ): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, body);
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function bulkAssign(chatbotId: string, body: { kind: string; ids: string[]; topicId: string | null }, actorFn = admin): Promise<ApiResponse<Record<string, unknown>>> {
    return actorFn('POST', `/chatbots/${chatbotId}/topic-assignments`, body);
  }

  function outputTexts(body: Record<string, unknown>): string[] {
    const outputs = (body.outputs as Array<{ type: string; payload: Record<string, unknown> }>) ?? [];
    return outputs.filter((o) => o.type === 'TEXT').map((o) => o.payload.text as string);
  }

  async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, opts: { maxWaitMs?: number; intervalMs?: number; label?: string } = {}): Promise<T> {
    const maxWaitMs = opts.maxWaitMs ?? 5000;
    const intervalMs = opts.intervalMs ?? 150;
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const v = await fn();
      if (predicate(v)) return v;
      if (Date.now() >= deadline) throw new Error(`pollUntil 시간 초과${opts.label ? `(${opts.label})` : ''}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /**
   * 기본 진입점 세트: FALLBACK(공통) 1개 + 표준 세 토픽(배송/환불/보험청구-비활성) — 시험데이터 §
   * "토픽 3개 + 교차 참조 표준 픽스처"(architect §21.1)를 이 함수가 코드로 고정한다.
   */
  async function setupStandardFixture(chatbotId: string): Promise<{
    shipping: { id: string };
    refund: { id: string };
    insurance: { id: string };
    fallbackNodeId: string;
  }> {
    const fallbackNodeId = await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '죄송해요, 이해하지 못했어요.' } }] });
    const shipping = await createTopic(chatbotId, { name: '배송', enabled: true });
    const refund = await createTopic(chatbotId, { name: '환불', enabled: true });
    const insurance = await createTopic(chatbotId, { name: '보험청구', enabled: false });
    return { shipping, refund, insurance, fallbackNodeId };
  }

  /* ============================================================================================
   * A.1 토픽 CRUD · 순서 · 활성 전환
   * ========================================================================================== */
  describe('A.1 토픽 CRUD·순서·활성 전환', () => {
    it('AC-TP1-3: 정규화 동일 이름은 409 DUPLICATE_NAME, 51번째 토픽은 409 LIMIT_EXCEEDED다', async () => {
      const { id: chatbotId } = await createChatbot();
      const first = await createTopic(chatbotId, { name: '배송' });
      expect(first.id).toBeTruthy();

      const dup = await admin('POST', `/chatbots/${chatbotId}/topics`, { name: ' 배송 ' });
      expect(dup.status).toBe(409);
      expect((dup.body as { code: string }).code).toBe('DUPLICATE_NAME');

      for (let i = 0; i < 49; i += 1) {
        const r = await admin('POST', `/chatbots/${chatbotId}/topics`, { name: `토픽-${i}` });
        expect(r.status).toBe(201);
      }
      // 지금까지 1(배송) + 49 = 50개 — 상한.
      const over = await admin('POST', `/chatbots/${chatbotId}/topics`, { name: '초과토픽' });
      expect(over.status).toBe(409);
      expect((over.body as { code: string }).code).toBe('LIMIT_EXCEEDED');
    }, 30_000);

    it('AC-TP1-4: 자산이 있는 토픽 삭제는 409 TOPIC_NOT_EMPTY, moveToCommon=true는 공통으로 옮기고 삭제(감사 2건)', async () => {
      const { id: chatbotId } = await createChatbot();
      const topic = await createTopic(chatbotId, { name: '배송' });
      await createIntent(chatbotId, { name: '배송조회', examples: ['배송 조회'], topicId: topic.id });

      const blocked = await admin('DELETE', `/chatbots/${chatbotId}/topics/${topic.id}`);
      expect(blocked.status).toBe(409);
      expect((blocked.body as { code: string }).code).toBe('TOPIC_NOT_EMPTY');

      const moved = await admin('DELETE', `/chatbots/${chatbotId}/topics/${topic.id}?moveToCommon=true`);
      expect(moved.status).toBe(204);

      const list = await admin<{ items: Array<{ id: string }> }>('GET', `/chatbots/${chatbotId}/topics`);
      expect(list.body.items.find((t) => t.id === topic.id)).toBeUndefined();

      const auditRes = await admin<{ items: Array<{ action: string; targetType: string }> }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      const topicAudits = auditRes.body.items.filter((a) => a.targetType === 'Topic');
      expect(topicAudits.some((a) => a.action === 'UPDATE')).toBe(true);
      expect(topicAudits.some((a) => a.action === 'DELETE')).toBe(true);
    });

    it('AC-TP1-5: 다른 챗봇의 토픽 id 지정은 404 INVALID_REFERENCE, START 노드 토픽 지정은 400 TOPIC_SYSTEM_NODE_LOCKED', async () => {
      const { id: chatbotA } = await createChatbot();
      const { id: chatbotB } = await createChatbot();
      const topicInB = await createTopic(chatbotB, { name: '배송' });

      const crossRef = await admin('POST', `/chatbots/${chatbotA}/intents`, { name: '교차참조의도', topicId: topicInB.id });
      expect(crossRef.status).toBe(404);
      expect((crossRef.body as { code: string }).code).toBe('INVALID_REFERENCE');

      const topicInA = await createTopic(chatbotA, { name: '배송' });
      const startLocked = await admin('POST', `/chatbots/${chatbotA}/dialog-nodes`, {
        name: '시작노드',
        nodeType: 'START',
        outputs: [{ type: 'TEXT', payload: { text: '안녕하세요' } }],
        topicId: topicInA.id,
      });
      expect(startLocked.status).toBe(400);
      expect((startLocked.body as { code: string }).code).toBe('TOPIC_SYSTEM_NODE_LOCKED');
    });

    it('토픽 순서 위/아래 버튼으로 sortOrder를 바꾼다', async () => {
      const { id: chatbotId } = await createChatbot();
      const t1 = await createTopic(chatbotId, { name: 'A토픽' });
      const t2 = await createTopic(chatbotId, { name: 'B토픽' });
      expect(t1.sortOrder).toBeLessThan(t2.sortOrder);

      const moveRes = await admin<{ items: Array<{ id: string; sortOrder: number }> }>('POST', `/chatbots/${chatbotId}/topics/${t1.id}/move`, { direction: 'DOWN' });
      expect(moveRes.status).toBe(201);
      const after1 = moveRes.body.items.find((t) => t.id === t1.id)!;
      const after2 = moveRes.body.items.find((t) => t.id === t2.id)!;
      expect(after1.sortOrder).toBeGreaterThan(after2.sortOrder);
    });
  });

  /* ============================================================================================
   * A.2 일괄·단건 지정 — updatedAt 보존 · 감사
   * ========================================================================================== */
  describe('A.2 일괄·단건 소속 지정', () => {
    it('AC-TP2-1: 일괄 지정 시 42건 대신 소규모로 검증 — 자산 6종의 topicId만 바뀌고 updatedAt은 보존되며 감사 요약 1건이 남는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });

      const intentId = await createIntent(chatbotId, { name: '주문조회', examples: ['주문 조회'] });
      const faqId = await createFaq(chatbotId, { question: '배송은 언제 오나요', answer: '2~3일 소요됩니다' });
      const keywordId = await createKeyword(chatbotId, { name: '@배송지역', synonyms: ['배송지역'] });
      const contextId = await createContext(chatbotId, { name: '배송폼', slots: [{ name: 'addr', label: '주소', prompt: '주소를 입력하세요', type: 'TEXT' }] });
      const nodeId = await createNode(chatbotId, { name: '배송응답', intentIds: [intentId], outputs: [{ type: 'TEXT', payload: { text: '배송 정보를 확인해요' } }] });

      const before = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      const beforeNode = await prisma.dialogNode.findUniqueOrThrow({ where: { id: nodeId } });

      await new Promise((r) => setTimeout(r, 20)); // updatedAt 변경 여부를 구분할 수 있게 짧게 대기.

      const assignIntent = await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: shipping.id });
      expect(assignIntent.status).toBe(201);
      const assignFaq = await bulkAssign(chatbotId, { kind: 'FAQ', ids: [faqId], topicId: shipping.id });
      expect(assignFaq.status).toBe(201);
      const assignKeyword = await bulkAssign(chatbotId, { kind: 'KEYWORD', ids: [keywordId], topicId: shipping.id });
      expect(assignKeyword.status).toBe(201);
      const assignContext = await bulkAssign(chatbotId, { kind: 'CONTEXT', ids: [contextId], topicId: shipping.id });
      expect(assignContext.status).toBe(201);
      const assignNode = await bulkAssign(chatbotId, { kind: 'NODE', ids: [nodeId], topicId: shipping.id });
      expect(assignNode.status).toBe(201);

      const after = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      expect(after.topicId).toBe(shipping.id);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime()); // ★ updatedAt 보존(§5.2 D-3)
      expect(after.name).toBe(before.name);
      expect(after.examples).toBe(before.examples);

      const afterNode = await prisma.dialogNode.findUniqueOrThrow({ where: { id: nodeId } });
      expect(afterNode.updatedAt.getTime()).toBe(beforeNode.updatedAt.getTime());

      const auditRes = await admin<{ items: Array<{ action: string; targetType: string; summary?: string }> }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      const topicUpdateAudits = auditRes.body.items.filter((a) => a.targetType === 'Topic' && a.action === 'UPDATE');
      expect(topicUpdateAudits.length).toBeGreaterThanOrEqual(5); // 종류별 요약 1건씩
    });

    it('AC-TP2-2: 일괄 지정 1,001건은 400이고 부분 성공이 없다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const fakeIds = Array.from({ length: 1001 }, () => randomUUID());
      const res = await bulkAssign(chatbotId, { kind: 'INTENT', ids: fakeIds, topicId: shipping.id });
      expect(res.status).toBe(400);
    });

    it('감사: 대상이 공통(topicId=null)이면 Chatbot 대상에 요약 1건이 남는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const intentId = await createIntent(chatbotId, { name: '주문조회2', examples: ['주문 조회 2'], topicId: shipping.id });

      await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: null });

      const auditRes = await admin<{ items: Array<{ action: string; targetType: string }> }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      expect(auditRes.body.items.some((a) => a.targetType === 'Chatbot' && a.action === 'UPDATE')).toBe(true);
    });

    it('AC-TP2-4: 가져오기는 신규 항목만 지정 토픽에 들어가고, 기존 이름 항목은 토픽을 바꾸지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const refund = await createTopic(chatbotId, { name: '환불' });
      const shipping = await createTopic(chatbotId, { name: '배송' });
      await createIntent(chatbotId, { name: '주문조회', examples: ['원래 예문'], topicId: refund.id });

      const content = csv(
        ['의도명', '예문', '설명'],
        [
          ['주문조회', '추가 예문', ''],
          ['반품접수', '반품 신청', ''],
        ],
      );
      const validate = await uploadCsv<{ importToken: string }>(`${baseUrl}/chatbots/${chatbotId}/intents/import/validate`, 'intents.csv', content, adminCookie);
      expect(validate.status).toBe(200);
      const commit = await admin<{ createdItems: number }>('POST', `/chatbots/${chatbotId}/intents/import/commit`, {
        importToken: validate.body.importToken,
        newItemTopicId: shipping.id,
      });
      expect(commit.status).toBe(200);
      expect(commit.body.createdItems).toBe(1); // 반품접수만 신규

      const list = await admin<{ items: Array<{ name: string; topicId: string | null }> }>('GET', `/chatbots/${chatbotId}/intents?pageSize=50`);
      const existing = list.body.items.find((i) => i.name === '주문조회')!;
      const created = list.body.items.find((i) => i.name === '반품접수')!;
      expect(existing.topicId).toBe(refund.id); // 기존 항목은 토픽 유지
      expect(created.topicId).toBe(shipping.id); // 신규 항목만 지정 토픽
    });
  });

  /* ============================================================================================
   * A.3/A.4 비활성 토픽의 대화 제외 · 공개 응답에 topic 노출 0
   * ========================================================================================== */
  describe('A.3/A.4 비활성 토픽의 대화 제외 · 공개 노출 0', () => {
    async function setupInsuranceScenario(): Promise<{
      chatbotId: string;
      slug: string;
      insuranceTopicId: string;
      insIntentId: string;
      insFaqId: string;
      insNodeId: string;
    }> {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWeb(chatbotId, slug);
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '죄송해요, 잘 몰라요.' } }] });

      const insurance = await createTopic(chatbotId, { name: '보험청구', enabled: false });
      const insIntentId = await createIntent(chatbotId, { name: '보험금청구', examples: ['보험금 청구 방법 문의'], topicId: insurance.id });
      const insFaqId = await createFaq(chatbotId, { question: '보험금 청구 서류가 뭔가요', answer: '청구서와 진단서가 필요합니다', topicId: insurance.id });
      const insNodeId = await createNode(chatbotId, {
        name: '보험금청구응답',
        intentIds: [insIntentId],
        outputs: [{ type: 'TEXT', payload: { text: '보험금 청구 절차를 안내해요' } }],
        topicId: insurance.id,
      });
      return { chatbotId, slug, insuranceTopicId: insurance.id, insIntentId, insFaqId, insNodeId };
    }

    it('AC-TP3-1: 비활성 토픽의 의도·FAQ·노드는 공개 대화에서 매칭되지 않고, 활성화하면 다시 매칭된다(캐시 무효화)', async () => {
      const { chatbotId, slug, insuranceTopicId } = await setupInsuranceScenario();
      const sessionId = randomUUID();

      const before = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '보험금 청구 방법 문의' });
      expect(outputTexts(before.body)).toEqual(['죄송해요, 잘 몰라요.']);

      const enableRes = await admin('POST', `/chatbots/${chatbotId}/topics/${insuranceTopicId}/enable`);
      expect(enableRes.status).toBe(201);

      // AC-TP3-7 — 같은 인스턴스는 invalidate() 직후부터 반영된다.
      const after = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '보험금 청구 방법 문의' });
      expect(outputTexts(after.body)).toEqual(['보험금 청구 절차를 안내해요']);
    });

    it('AC-TP3-1(FAQ): 비활성 토픽 FAQ 질문도 폴백으로 응답한다', async () => {
      const { slug } = await setupInsuranceScenario();
      const res = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '보험금 청구 서류가 뭔가요' });
      expect(outputTexts(res.body)).toEqual(['죄송해요, 잘 몰라요.']);
    });

    it('AC-TP3-3: 비활성 토픽 소속 키워드를 활성 노드가 조건으로 써도 정상 응답한다(사전형 자산은 제외 안 함)', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWeb(chatbotId, slug);
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });

      const insurance = await createTopic(chatbotId, { name: '보험청구', enabled: false });
      const keywordId = await createKeyword(chatbotId, { name: '@청구서류', synonyms: ['청구서류'], topicId: insurance.id });
      const intentId = await createIntent(chatbotId, { name: '서류문의', examples: [] });
      await createNode(chatbotId, {
        name: '서류안내',
        keywordIds: [keywordId],
        intentIds: [intentId],
        outputs: [{ type: 'TEXT', payload: { text: '서류 안내드릴게요' } }],
      });

      const res = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '청구서류가 뭔가요' });
      expect(outputTexts(res.body)).toEqual(['서류 안내드릴게요']);
    });

    it('AC-TP3-4: 활성 노드의 DIALOG_MOVE가 비활성 토픽 노드를 가리키면 크래시 없이 BROKEN_REFERENCE로 건너뛰고, 영향 미리보기에 끊기는 참조가 보인다', async () => {
      const { chatbotId, slug, insuranceTopicId, insNodeId } = await setupInsuranceScenario();

      const moveIntentId = await createIntent(chatbotId, { name: '이동트리거', examples: ['보험청구페이지로가줘'] });
      await createNode(chatbotId, {
        name: '이동노드',
        intentIds: [moveIntentId],
        outputs: [
          { type: 'TEXT', payload: { text: '안내드릴게요' } },
          { type: 'DIALOG_MOVE', payload: { targetNodeId: insNodeId } },
        ],
      });

      const res = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '보험청구페이지로가줘' });
      expect(res.status).toBe(200); // 크래시 없음
      expect(outputTexts(res.body)).toEqual(['안내드릴게요']); // 이동은 건너뛰고 나머지 아웃풋만 나간다

      const impact = await admin<{ brokenRefs: { total: number } }>('GET', `/chatbots/${chatbotId}/topics/${insuranceTopicId}/impact?action=DISABLE`);
      expect(impact.status).toBe(200);
      expect(impact.body.brokenRefs.total).toBeGreaterThanOrEqual(1);
    });

    it('AC-TP3-2: 임베딩이 켜져 있어도 비활성 토픽 의도는 색인·의미 되묻기(답변 설정 미리보기) 후보에서 제외된다(재색인 없이)', async () => {
      const { chatbotId, slug, insIntentId } = await setupInsuranceScenario();
      void slug;

      // 비활성 토픽만 있으면 번들의 후보(의도·FAQ)가 0건이라 semanticMatch.score()가 항상 null(색인
      // 비어있음)을 반환한다 — 그러면 "제외됐다"를 증명할 기준점(활성 후보)이 없다. 활성(공통) 의도를
      // 하나 더 만들어 번들에 실제 후보가 있는 상태를 만든다.
      const activeIntentId = await createIntent(chatbotId, { name: '배송조회활성', examples: ['배송 조회 원해요'] }); // 공통(항상 활성)
      await createNode(chatbotId, { name: '배송조회노드', intentIds: [activeIntentId], outputs: [{ type: 'TEXT', payload: { text: '배송 확인해요' } }] });

      // 의미 매칭 활성화 — 배경 재색인이 목 임베딩 서버로 예문을 색인할 때까지 대기(활성 의도만 색인 대상).
      const settingsRes = await admin('PUT', `/chatbots/${chatbotId}/answer-settings`, { semanticEnabled: true });
      expect(settingsRes.status).toBe(200);

      await pollUntil(
        () => prisma.embeddingVector.count({ where: { chatbotId, ownerId: activeIntentId, status: 'READY' } }),
        (n) => n > 0,
        { maxWaitMs: 10_000, label: '활성 의도 임베딩 색인 완료' },
      );

      // (참고) 색인 자체는 토픽과 무관하게(textHash 기준) 이루어질 수 있다 — 제외는 매칭 시점의
      // 번들 필터(assembleSemanticInput)에서 일어난다. 그래서 벡터 행 존재 여부가 아니라 아래
      // top3 결과로 제외를 증명한다.
      await new Promise((r) => setTimeout(r, 500));

      // 완전히 같은 벡터로 귀결되는 질의("보험금" 포함) — 비활성 토픽이 아니었다면 유력 후보였을 문장.
      const preview = await admin<{ band: string; top3: Array<{ id: string; kind: string }> }>('POST', `/chatbots/${chatbotId}/answer-settings/preview`, {
        message: '보험금은 어떻게 청구하나요',
      });
      expect(preview.status).toBe(200);
      expect(preview.body.top3.some((c) => c.id === insIntentId)).toBe(false);

      // 대조군 — 활성 의도를 겨냥한 질의("배송" 포함)는 정상적으로 top3(및 band)에 후보로 나온다.
      const activePreview = await admin<{ band: string; top3: Array<{ id: string; kind: string }> }>('POST', `/chatbots/${chatbotId}/answer-settings/preview`, {
        message: '배송이 언제 오나요',
      });
      expect(activePreview.status).toBe(200);
      expect(activePreview.body.top3.some((c) => c.id === activeIntentId)).toBe(true);
    }, 20_000);

    it('AC-TP3-8: 비활성 토픽 FAQ는 상담 힌트에도 나오지 않는다', async () => {
      const { chatbotId, slug, insFaqId } = await setupInsuranceScenario();
      await admin('PUT', `/chatbots/${chatbotId}/handoff-settings`, {
        enabled: true,
        cautionThreshold: 2,
        warningThreshold: 3,
        activeWindowMinutes: 10,
        userIdleMinutes: 10,
        agentNoReplyMinutes: 5,
        connectNotice: '상담원이 연결되었어요.',
        endNotice: '상담이 종료되었어요.',
        failNotice: '연결이 어려워요.',
      });
      const sessionId = randomUUID();
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '보험금 청구 서류가 뭔가요' });
      const listRes = await pollUntil(
        () => admin<{ items: Array<{ sessionRef: string }> }>('GET', `/chatbots/${chatbotId}/live-sessions`),
        (r) => r.body.items.length > 0,
        { maxWaitMs: 5000, label: '라이브세션 목록' },
      );
      const sessionRef = listRes.body.items[0].sessionRef;
      const hintsRes = await admin<{ faqs?: Array<{ id: string }> }>('GET', `/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`);
      expect(hintsRes.status).toBe(200);
      const hintFaqIds = (hintsRes.body.faqs ?? []).map((f) => f.id);
      expect(hintFaqIds).not.toContain(insFaqId);
    });

    it('AC-TP3-6: 시뮬레이터는 includeInactiveTopics로 비활성 토픽을 포함하고 answeredTopic을 채우며, 운영 캐시를 오염시키지 않는다', async () => {
      const { chatbotId, slug, insIntentId } = await setupInsuranceScenario();

      const withoutFlag = await admin<{ outputs: Array<{ type: string }> }>('POST', `/chatbots/${chatbotId}/simulate`, { message: '보험금 청구 방법 문의' });
      expect(outputTexts(withoutFlag.body as Record<string, unknown>)).toEqual(['죄송해요, 잘 몰라요.']);

      const withFlag = await admin<{ matchedIntentId?: string; answeredTopic?: { name: string; enabled: boolean } }>('POST', `/chatbots/${chatbotId}/simulate`, {
        message: '보험금 청구 방법 문의',
        includeInactiveTopics: true,
      });
      expect(withFlag.body.matchedIntentId).toBe(insIntentId);
      expect(withFlag.body.answeredTopic?.name).toBe('보험청구');
      expect(withFlag.body.answeredTopic?.enabled).toBe(false);

      // 시뮬레이터 조회 뒤에도 공개 대화는 여전히 폴백이다(운영 캐시 오염 0).
      const publicAfter = await anon<Record<string, unknown>>('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '보험금 청구 방법 문의' });
      expect(outputTexts(publicAfter.body)).toEqual(['죄송해요, 잘 몰라요.']);
    });

    it('ConversationLog.topicId가 답한 노드의 당시 토픽으로 적재된다', async () => {
      const { id: chatbotId, slug } = await createChatbot();
      await activateWeb(chatbotId, slug);
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const intentId = await createIntent(chatbotId, { name: '배송조회', examples: ['배송 조회 부탁'], topicId: shipping.id });
      await createNode(chatbotId, { name: '배송응답', intentIds: [intentId], outputs: [{ type: 'TEXT', payload: { text: '배송 확인해요' } }], topicId: shipping.id });

      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '배송 조회 부탁' });

      const log = await pollUntil(
        () => prisma.conversationLog.findFirst({ where: { chatbotId, matchedIntentId: intentId }, orderBy: { createdAt: 'desc' } }),
        (l) => l !== null,
        { maxWaitMs: 3000, label: 'ConversationLog 적재' },
      );
      expect(log?.topicId).toBe(shipping.id);
    });

    it('AC-TP4-4/공개 노출 0: 공개 대화·폴링 응답 본문 전체를 grep해도 topic이 없다', async () => {
      const { chatbotId, slug } = await setupInsuranceScenario();
      const configRes = await anon('GET', `/public/chatbots/${slug}/config`);
      expect(JSON.stringify(configRes.body).toLowerCase()).not.toContain('topic');

      const sessionId = randomUUID();
      const msgRes = await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '아무말' });
      expect(JSON.stringify(msgRes.body).toLowerCase()).not.toContain('topic');

      // handoff 폴링 응답도 확인(상담 미개설이어도 스키마 노출 여부만 본다 — 401/설정없음이어도 본문에 topic 없어야 함).
      const pollRes = await anon('GET', `/public/chatbots/${slug}/handoff?after=0`, undefined);
      expect(JSON.stringify(pollRes.body).toLowerCase()).not.toContain('topic');
      void chatbotId;
    });
  });

  /* ============================================================================================
   * A.5 설계 점검 규칙 4종 · ruleTotals · 영향 미리보기
   * ========================================================================================== */
  describe('A.5 설계 점검 규칙 · 영향 미리보기', () => {
    it('AC-TP4-1: INACTIVE_TOPIC_REFERENCE 경고·CROSS_TOPIC_REFERENCE 정보가 출발·도착 토픽 이름과 함께 나온다', async () => {
      const { id: chatbotId } = await setupInsuranceScenario_forDesignCheck();

      async function setupInsuranceScenario_forDesignCheck() {
        const bot = await createChatbot();
        await activateWeb(bot.id, bot.slug);
        await createNode(bot.id, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
        return bot;
      }

      const shipping = await createTopic(chatbotId, { name: '배송' });
      const refund = await createTopic(chatbotId, { name: '환불' });
      const insurance = await createTopic(chatbotId, { name: '보험청구', enabled: false });

      const refundIntentId = await createIntent(chatbotId, { name: '환불신청', examples: ['환불 신청'], topicId: refund.id });
      const insDummyIntentId = await createIntent(chatbotId, { name: '보험더미의도', examples: ['보험 더미'], topicId: insurance.id });
      const insNodeId = await createNode(chatbotId, { name: '보험노드', intentIds: [insDummyIntentId], outputs: [{ type: 'TEXT', payload: { text: '보험' } }], topicId: insurance.id });

      await createNode(chatbotId, {
        name: '배송노드',
        intentIds: [refundIntentId], // 배송 토픽 노드가 환불 토픽 의도를 조건으로 사용 → CROSS_TOPIC_REFERENCE
        outputs: [
          { type: 'TEXT', payload: { text: '배송 안내' } },
          { type: 'DIALOG_MOVE', payload: { targetNodeId: insNodeId } }, // 비활성 토픽 노드로 이동 → INACTIVE_TOPIC_REFERENCE
        ],
        topicId: shipping.id,
      });

      const validate = await admin<{ issues: Array<{ code: string; topicRef?: { sourceTopicName: string; targetTopicName: string } }>; ruleTotals?: Record<string, number> }>(
        'POST',
        `/chatbots/${chatbotId}/dialog-nodes/validate`,
        {},
      );
      expect(validate.status).toBe(200);
      const inactiveIssue = validate.body.issues.find((i) => i.code === 'INACTIVE_TOPIC_REFERENCE');
      expect(inactiveIssue).toBeDefined();
      expect(inactiveIssue?.topicRef?.sourceTopicName).toBe('배송');
      expect(inactiveIssue?.topicRef?.targetTopicName).toBe('보험청구');

      const crossIssue = validate.body.issues.find((i) => i.code === 'CROSS_TOPIC_REFERENCE');
      expect(crossIssue).toBeDefined();
    });

    it('AC-TP4-2: 서로 다른 토픽 의도의 예문 중복은 저장은 성공하되 CROSS_TOPIC_DUPLICATE_EXAMPLE 정보로 잡힌다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const refund = await createTopic(chatbotId, { name: '환불' });
      await createIntent(chatbotId, { name: '배송문의', examples: ['택배 언제 와'], topicId: shipping.id });
      const secondRes = await admin<{ meta: { conflicts: Array<{ intentName: string; topicName?: string }> } }>('POST', `/chatbots/${chatbotId}/intents`, {
        name: '환불문의',
        examples: ['택배 언제 와'],
        topicId: refund.id,
      });
      expect(secondRes.status).toBe(201);
      expect(secondRes.body.meta.conflicts.some((c) => c.intentName === '배송문의')).toBe(true);

      const validate = await admin<{ issues: Array<{ code: string }> }>('POST', `/chatbots/${chatbotId}/dialog-nodes/validate`, {});
      expect(validate.body.issues.some((i) => i.code === 'CROSS_TOPIC_DUPLICATE_EXAMPLE')).toBe(true);
    });

    it('AC-TP4-3: 토픽 A 키워드 동의어를 토픽 B 키워드에 추가하면 차단되고 상대 키워드·토픽 이름이 오류에 담긴다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const refund = await createTopic(chatbotId, { name: '환불' });
      await createKeyword(chatbotId, { name: '@반품키워드A', synonyms: ['반품'], topicId: shipping.id });
      const conflictRes = await admin<{ code: string; message: string }>('POST', `/chatbots/${chatbotId}/keywords`, {
        name: '@반품키워드B',
        synonyms: ['반품'],
        topicId: refund.id,
      });
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.code).toBe('SYNONYM_CONFLICT');
      expect(conflictRes.body.message).toContain('배송');
    });

    it('AC-TP4-4: 토픽이 없는 챗봇은 토픽 규칙 추가 전후로 설계 점검 결과가 같다(회귀 0)', async () => {
      const { id: chatbotId } = await createChatbot();
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
      const validate = await admin<{ issues: Array<{ code: string }> }>('POST', `/chatbots/${chatbotId}/dialog-nodes/validate`, {});
      expect(validate.status).toBe(200);
      const topicIssues = validate.body.issues.filter((i) => ['INACTIVE_TOPIC_REFERENCE', 'CROSS_TOPIC_REFERENCE', 'CROSS_TOPIC_DUPLICATE_EXAMPLE', 'NO_LIVE_ENTRY_POINT'].includes(i.code));
      expect(topicIssues).toEqual([]);
    });

    it('EX-TP-1/AC-TP3-8류: 토픽이 모두 비활성이면 NO_LIVE_ENTRY_POINT 경고가 나온다', async () => {
      const { id: chatbotId } = await createChatbot();
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
      const insurance = await createTopic(chatbotId, { name: '보험청구', enabled: false });
      const intentId = await createIntent(chatbotId, { name: '유일한의도', examples: ['유일한 예문'], topicId: insurance.id });
      await createNode(chatbotId, { name: '유일한노드', intentIds: [intentId], outputs: [{ type: 'TEXT', payload: { text: '응답' } }], topicId: insurance.id });

      const validate = await admin<{ issues: Array<{ code: string }> }>('POST', `/chatbots/${chatbotId}/dialog-nodes/validate`, {});
      expect(validate.body.issues.some((i) => i.code === 'NO_LIVE_ENTRY_POINT')).toBe(true);
    });
  });

  /* ============================================================================================
   * A.6 분리(split)
   * ========================================================================================== */
  describe('A.6 토픽 → 새 챗봇 분리', () => {
    async function setupSplitFixture(): Promise<{ chatbotId: string; insurance: { id: string }; insIntentId: string; commonIntentId: string; insNodeId: string; startId: string; fallbackId: string }> {
      const { id: chatbotId } = await createChatbot();
      const startId = await createNode(chatbotId, { name: '시작', nodeType: 'START', outputs: [{ type: 'TEXT', payload: { text: '안녕하세요' } }] });
      const fallbackId = await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });

      const insurance = await createTopic(chatbotId, { name: '보험청구' });
      const commonIntentId = await createIntent(chatbotId, { name: '공통인사', examples: ['안녕'] }); // 공통 자산(폐포 대상)
      const insIntentId = await createIntent(chatbotId, { name: '보험금청구', examples: ['보험금 청구'], topicId: insurance.id });
      const insNodeId = await createNode(chatbotId, {
        name: '보험금청구응답',
        intentIds: [insIntentId, commonIntentId],
        outputs: [{ type: 'TEXT', payload: { text: '보험금 청구 안내' } }],
        topicId: insurance.id,
      });
      return { chatbotId, insurance, insIntentId, commonIntentId, insNodeId, startId, fallbackId };
    }

    it('AC-TP5-1: 분리 미리보기는 토픽 자산·폐포·시스템 노드 수를 보고하고 DB를 바꾸지 않는다', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();
      const before = await prisma.dialogNode.count({ where: { chatbotId } });

      const preview = await admin<{
        selected: { dialogNodes: number; intents: number };
        closureItems: { total: number };
        systemNodes: { start: boolean; fallback: boolean };
      }>('POST', `/chatbots/${chatbotId}/topics/split/preview`, { topicIds: [insurance.id] });
      expect(preview.status).toBe(201);
      expect(preview.body.selected.dialogNodes).toBe(1);
      expect(preview.body.selected.intents).toBe(1);
      expect(preview.body.closureItems.total).toBeGreaterThanOrEqual(1); // 공통인사가 폐포로 딸려온다
      expect(preview.body.systemNodes.start).toBe(true);
      expect(preview.body.systemNodes.fallback).toBe(true);

      const after = await prisma.dialogNode.count({ where: { chatbotId } });
      expect(after).toBe(before); // DB 변경 0
    });

    it('AC-TP5-2/5-3: 분리 실행 후 원본은 바이트 동일(행 수·contentHash)하고, 새 챗봇은 DRAFT·모든 새 ID·BROKEN_REFERENCE 0이다', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();

      const beforeCounts = {
        intents: await prisma.intent.count({ where: { chatbotId } }),
        nodes: await prisma.dialogNode.count({ where: { chatbotId } }),
      };
      const beforeVersion = await admin<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`);
      const beforeHash = beforeVersion.body.contentHash;

      const originalIds = new Set<string>([
        ...(await prisma.intent.findMany({ where: { chatbotId }, select: { id: true } })).map((r) => r.id),
        ...(await prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true } })).map((r) => r.id),
      ]);

      const splitRes = await admin<{ chatbot: { id: string; status: string }; totals: Record<string, number> }>('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [insurance.id] });
      expect(splitRes.status).toBe(201);
      expect(splitRes.body.chatbot.status).toBe('DRAFT');
      const newChatbotId = splitRes.body.chatbot.id;

      // 원본 불변.
      const afterCounts = {
        intents: await prisma.intent.count({ where: { chatbotId } }),
        nodes: await prisma.dialogNode.count({ where: { chatbotId } }),
      };
      expect(afterCounts).toEqual(beforeCounts);
      const afterVersion = await admin<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`);
      expect(afterVersion.body.contentHash).toBe(beforeHash);

      // 새 챗봇: 모든 ID가 새로 발급됐다(원본 ID 0건).
      const newIntentIds = (await prisma.intent.findMany({ where: { chatbotId: newChatbotId }, select: { id: true } })).map((r) => r.id);
      const newNodeIds = (await prisma.dialogNode.findMany({ where: { chatbotId: newChatbotId }, select: { id: true } })).map((r) => r.id);
      expect(newIntentIds.some((id) => originalIds.has(id))).toBe(false);
      expect(newNodeIds.some((id) => originalIds.has(id))).toBe(false);
      expect(newIntentIds.length).toBeGreaterThan(0);
      expect(newNodeIds.length).toBeGreaterThan(0);

      const newValidate = await admin<{ issues: Array<{ code: string }> }>('POST', `/chatbots/${newChatbotId}/dialog-nodes/validate`, {});
      expect(newValidate.body.issues.some((i) => i.code === 'BROKEN_REFERENCE')).toBe(false);
    });

    it('AC-TP5-9: 분리 완료 시 새 챗봇에 COPY 1건, 원본에는 감사가 없다', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();
      const beforeAudit = await admin<{ items: unknown[] }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      const beforeCount = beforeAudit.body.items.length;

      const splitRes = await admin<{ chatbot: { id: string } }>('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [insurance.id] });
      const newChatbotId = splitRes.body.chatbot.id;

      const afterAudit = await admin<{ items: unknown[] }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      expect(afterAudit.body.items.length).toBe(beforeCount); // 원본 감사 없음

      const newAudit = await admin<{ items: Array<{ action: string; targetType: string }> }>('GET', `/audit-logs?chatbotId=${newChatbotId}`);
      expect(newAudit.body.items.some((a) => a.action === 'COPY' && a.targetType === 'Chatbot')).toBe(true);
    });

    it('시작·폴백 노드의 범위 밖 연결: 기본(TRIM)은 잘라내고, FOLLOW 옵션은 따라간다', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();

      // 분리 대상(보험청구 토픽)에 속하지도, 그 폐포에도 들어오지 않는 별도 공통 노드 — 시작 노드가
      // 여기로 가는 버튼을 가지면 '범위 밖' 연결이 된다(insNodeId는 선택 토픽 자신이라 폐포 안이라서
      // 트림 대상이 아니다 — 처음 설계의 오류를 여기서 바로잡는다).
      const outOfScopeIntentId = await createIntent(chatbotId, { name: '범위밖의도', examples: ['범위 밖 예문'] });
      const outOfScopeNodeId = await createNode(chatbotId, { name: '범위밖공통노드', intentIds: [outOfScopeIntentId], outputs: [{ type: 'TEXT', payload: { text: '범위 밖 응답' } }] });

      // 시작 노드에 범위 밖 공통 노드로 가는 버튼을 추가한다.
      const startList = await admin<{ items: Array<{ id: string; nodeType: string }> }>('GET', `/chatbots/${chatbotId}/dialog-nodes?nodeType=START&pageSize=20`);
      const startId = startList.body.items[0].id;
      // TEXT 아웃풋을 함께 두어 버튼이 잘렸을 때도 결과 아웃풋이 0개가 되지 않게 한다 — 0개가 되면
      // '빈 결과' 보정(TRIM_WOULD_EMPTY)이 발동해 대신 FOLLOW로 처리되므로(system-node-trim.ts 93~107행),
      // 이 시험이 노리는 '일반 TRIM' 경로와 다른 경로를 타게 된다.
      await admin('PATCH', `/chatbots/${chatbotId}/dialog-nodes/${startId}`, {
        outputs: [
          { type: 'TEXT', payload: { text: '안녕하세요' } },
          { type: 'BUTTON', payload: { buttons: [{ label: '범위밖', action: 'NODE', value: outOfScopeNodeId }] } },
        ],
      });

      const trimPreview = await admin<{ trimmedLinks: { total: number }; followedSystemLinks: { total: number } }>('POST', `/chatbots/${chatbotId}/topics/split/preview`, {
        topicIds: [insurance.id],
        systemNodeLinks: 'TRIM',
      });
      expect(trimPreview.body.trimmedLinks.total).toBeGreaterThanOrEqual(1);

      const followPreview = await admin<{ trimmedLinks: { total: number } }>('POST', `/chatbots/${chatbotId}/topics/split/preview`, {
        topicIds: [insurance.id],
        systemNodeLinks: 'FOLLOW',
      });
      expect(followPreview.body.trimmedLinks.total).toBe(0);
    });

    it('AC-TP5-4: 분리본의 동점 승자가 원본과 같다(ID 순서·타임스탬프 보존)', async () => {
      const { id: chatbotId } = await createChatbot();
      await createNode(chatbotId, { name: '시작', nodeType: 'START', outputs: [{ type: 'TEXT', payload: { text: '안녕' } }] });
      await createNode(chatbotId, { name: '폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
      const insurance = await createTopic(chatbotId, { name: '보험청구' });

      // 동점 예문("청구 문의")을 가진 의도 2개 — A가 먼저 생성됨.
      const intentA = await createIntent(chatbotId, { name: 'A의도', examples: ['청구 문의'], topicId: insurance.id });
      await new Promise((r) => setTimeout(r, 15));
      const intentB = await createIntent(chatbotId, { name: 'B의도', examples: ['청구 문의'], topicId: insurance.id });
      await createNode(chatbotId, { name: 'A노드', intentIds: [intentA], outputs: [{ type: 'TEXT', payload: { text: 'A가 답함' } }], topicId: insurance.id });
      await createNode(chatbotId, { name: 'B노드', intentIds: [intentB], outputs: [{ type: 'TEXT', payload: { text: 'B가 답함' } }], topicId: insurance.id });

      const beforeSim = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${chatbotId}/simulate`, { message: '청구 문의' });
      const beforeWinner = beforeSim.body.outputs[0]?.payload.text;
      expect(beforeWinner).toBe('A가 답함');

      const splitRes = await admin<{ chatbot: { id: string } }>('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [insurance.id] });
      const newChatbotId = splitRes.body.chatbot.id;

      const afterSim = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${newChatbotId}/simulate`, { message: '청구 문의' });
      expect(afterSim.body.outputs[0]?.payload.text).toBe('A가 답함'); // 동점 승자 보존
    });

    it('AC-TP5-7: 동기 상한 초과 시 TOPIC_SPLIT_TOO_LARGE이고 아무것도 생기지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const big = await createTopic(chatbotId, { name: '대량토픽' });

      // 상한이 가장 낮은 종류(컨텍스트 200, TOPIC_SPLIT_LIMITS)를 201개로 초과시킨다 — 의도 1,001개
      // (각 예문 포함)로 트리거하면 분리 트랜잭션의 캡처 단계(전체 번들 조회)가 무거워져, 병렬로
      // 전체 스위트를 돌릴 때(CPU 경합) Prisma 트랜잭션 자체 타임아웃(30초)을 넘겨 버려
      // '422 TOPIC_SPLIT_TOO_LARGE' 대신 '500'(트랜잭션 만료)으로 간헐적으로 실패했다(실측 — 3회
      // 반복 중 2회 재현, 전체 스위트 상세는 자동시험_전략.md §14 "발견한 결함" 참고). 같은 상한 초과
      // 시나리오를 훨씬 가벼운 자산(컨텍스트, HTTP 요청 없이 Prisma로 직접 시딩)으로 바꿔 시험
      // 자체의 안정성을 확보한다 — 검증 대상(사전 상한 검사가 실제로 동작하는지)은 동일하다.
      const contextRows = Array.from({ length: 201 }, (_, i) => ({
        id: randomUUID(),
        chatbotId,
        name: `대량컨텍스트-${i}`,
        nameNormalized: `대량컨텍스트-${i}`.toLowerCase(),
        slots: JSON.stringify([{ name: 'slot1', label: '슬롯1', prompt: '입력해 주세요', type: 'TEXT' }]),
        topicId: big.id,
      }));
      await prisma.contextVariable.createMany({ data: contextRows });

      const chatbotCountBefore = await prisma.chatbot.count();
      const splitRes = await admin('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [big.id] });
      expect(splitRes.status).toBe(422);
      expect((splitRes.body as { code: string }).code).toBe('TOPIC_SPLIT_TOO_LARGE');
      const chatbotCountAfter = await prisma.chatbot.count();
      expect(chatbotCountAfter).toBe(chatbotCountBefore); // 새 챗봇 행조차 생기지 않았다
    }, 60_000);

    it('slug 충돌 시 409 DUPLICATE_SLUG다', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();
      const { slug: takenSlug } = await createChatbot();
      const res = await admin('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [insurance.id], slug: takenSlug });
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('DUPLICATE_SLUG');
    });

    it('권한: dialogue:read AND chatbot:write가 필요하다 — VIEWER·AGENT는 403', async () => {
      const { chatbotId, insurance } = await setupSplitFixture();
      const viewerRes = await viewer('POST', `/chatbots/${chatbotId}/topics/split/preview`, { topicIds: [insurance.id] });
      expect(viewerRes.status).toBe(403);
      const agentRes = await agent('POST', `/chatbots/${chatbotId}/topics/split/preview`, { topicIds: [insurance.id] });
      expect(agentRes.status).toBe(403);
      const editorRes = await editor('POST', `/chatbots/${chatbotId}/topics/split/preview`, { topicIds: [insurance.id] });
      expect(editorRes.status).toBe(201); // EDITOR는 dialogue:write+chatbot:write 모두 보유
    });
  });

  /* ============================================================================================
   * A.7 버전 스냅샷 · 복원
   * ========================================================================================== */
  describe('A.7 버전 스냅샷·복원', () => {
    it('AC-TP6-1(등가): 소속 변경은 해시를 바꾸지만, 공통으로 되돌리면 원래 해시로 복귀한다(토픽 없는 챗봇 해시 불변의 실증)', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentId = await createIntent(chatbotId, { name: '해시확인의도', examples: ['해시 확인'] });

      const v1 = await admin<{ version: { contentHash: string } } | { latestVersionId: string }>('POST', `/chatbots/${chatbotId}/versions`, {});
      const hash1 = (v1.body as { version?: { contentHash: string } }).version?.contentHash ?? (await admin<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;

      const topic = await createTopic(chatbotId, { name: '임시토픽' });
      await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: topic.id });
      const hashAfterAssign = (await admin<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;
      expect(hashAfterAssign).not.toBe(hash1); // 소속 변경은 해시를 바꾼다(EX-TP-15)

      await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: null });
      const hashBack = (await admin<{ contentHash: string }>('GET', `/chatbots/${chatbotId}/versions/current`)).body.contentHash;
      expect(hashBack).toBe(hash1); // 공통으로 되돌리면 해시도 되돌아온다 — 값 없는 topicId는 직렬화에서 생략됨을 실증
    });

    it('AC-TP6-2/EX-TP-16: 없는 토픽을 가리키는 버전을 복원하면 공통으로 정규화되고 TOPIC_MISSING 경고가 나온다', async () => {
      const { id: chatbotId } = await createChatbot();
      const topic = await createTopic(chatbotId, { name: '사라질토픽' });
      const intentId = await createIntent(chatbotId, { name: 'TM의도', examples: ['원본 예문'], topicId: topic.id });
      const v1res = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: 'v1' });
      const versionId = v1res.body.version.id;

      // 토픽을 지우고(공통으로 옮기고 삭제) 의도 내용도 바꿔 v1과 현재 상태를 실질적으로 다르게 만든다.
      await admin('DELETE', `/chatbots/${chatbotId}/topics/${topic.id}?moveToCommon=true`);
      await admin('PATCH', `/chatbots/${chatbotId}/intents/${intentId}`, { examples: ['바뀐 예문'] });

      const preview = await admin<{ warnings: Array<{ code: string; count?: number }>; restorable: boolean; currentContentHash: string }>(
        'POST',
        `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`,
        {},
      );
      expect(preview.status).toBe(200);
      expect(preview.body.warnings.some((w) => w.code === 'TOPIC_MISSING')).toBe(true);

      const restoreRes = await admin<{ contentHash: string }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
      });
      expect(restoreRes.status).toBe(200);

      const restoredIntent = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      expect(restoredIntent.topicId).toBeNull(); // 공통으로 적재됐다
      expect(JSON.parse(restoredIntent.examples)).toEqual(['원본 예문']);
    }, 15_000);

    it('TOPIC_EXPOSURE_CHANGE: 노출이 바뀌면 acknowledgeTopicExposure 없이는 400, 있으면 성공한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentId = await createIntent(chatbotId, { name: '노출확인의도', examples: ['노출 확인'] }); // 처음엔 공통(항상 활성)
      const v1res = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: 'v1-공통' });
      const versionId = v1res.body.version.id;

      // 비활성 토픽으로 옮긴다 — 현재 상태(비활성=숨김) vs 대상 v1(공통=노출)이 노출 변화를 만든다.
      const hidden = await createTopic(chatbotId, { name: '숨김토픽', enabled: false });
      await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: hidden.id });

      const preview = await admin<{ currentContentHash: string; warnings: Array<{ code: string }> }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`, {});
      expect(preview.body.warnings.some((w) => w.code === 'TOPIC_EXPOSURE_CHANGE')).toBe(true);

      const withoutAck = await admin('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, { expectedCurrentHash: preview.body.currentContentHash });
      expect(withoutAck.status).toBe(400);

      const withAck = await admin('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, {
        expectedCurrentHash: preview.body.currentContentHash,
        acknowledgeTopicExposure: true,
      });
      expect(withAck.status).toBe(200);
      const restored = await prisma.intent.findUniqueOrThrow({ where: { id: intentId } });
      expect(restored.topicId).toBeNull();
    }, 15_000);

    it('AC-TP6-3: 토픽 활성 전환은 감사만 남기고 버전 자동 스냅샷은 만들지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const topic = await createTopic(chatbotId, { name: '전환토픽' });
      const before = await admin<{ items: unknown[] }>('GET', `/chatbots/${chatbotId}/versions`);
      await admin('POST', `/chatbots/${chatbotId}/topics/${topic.id}/disable`);
      await admin('POST', `/chatbots/${chatbotId}/topics/${topic.id}/enable`);
      const after = await admin<{ items: unknown[] }>('GET', `/chatbots/${chatbotId}/versions`);
      expect(after.body.items.length).toBe(before.body.items.length);

      const auditRes = await admin<{ items: Array<{ action: string; targetType: string }> }>('GET', `/audit-logs?chatbotId=${chatbotId}`);
      expect(auditRes.body.items.filter((a) => a.targetType === 'Topic' && a.action === 'STATUS_CHANGE').length).toBeGreaterThanOrEqual(2);
    }, 15_000);

    /**
     * TOCTOU 재현 — §11.2·§21.1. "확인(preview에서 읽은 currentContentHash 산정 시점)"과 "실제 복원
     * 트랜잭션 진입 시점" 사이에 다른 요청이 토픽을 토글하면 RESTORE_PREVIEW_STALE로 거부되어야
     * 한다(`version-restore.service.ts` 259~274행 — exposureForGate vs exposureInTx 재확인). 실제
     * HTTP 동시 요청으로 재현한다: exposureForGate는 pre-tx 단계에서 여러 순차 DB 라운드트립(약 6회)을
     * 거치고 disable은 훨씬 짧아(약 2~3회) 같은 이벤트 루프 안에서 restore가 먼저 시작해도 disable이
     * 먼저 끝나 tx 진입 전에 반영될 개연성이 높다. 타이밍 의존 시험이라 최대 5회 재시도한다 — 5회
     * 안에 재현되지 않으면 "재현 불가"로 보고하고 이 테스트를 실패시켜 알린다(조용히 통과시키지 않음).
     */
    it('TOCTOU: 확인 이후 토픽 토글이 경합하면 RESTORE_PREVIEW_STALE이 나온다(실제 동시 HTTP)', async () => {
      let reproduced = false;
      let lastStatuses: number[] = [];
      for (let attempt = 0; attempt < 5 && !reproduced; attempt += 1) {
        const { id: chatbotId } = await createChatbot();
        const intentId = await createIntent(chatbotId, { name: `TOCTOU의도${attempt}`, examples: ['toctou 확인'] });
        const v1res = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: 'toctou-v1' });
        const versionId = v1res.body.version.id;

        const topic = await createTopic(chatbotId, { name: `TOCTOU토픽${attempt}`, enabled: true }); // 활성 → gate 통과(노출 변화 0)
        await bulkAssign(chatbotId, { kind: 'INTENT', ids: [intentId], topicId: topic.id });

        const preview = await admin<{ currentContentHash: string; warnings: Array<{ code: string }> }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`, {});
        expect(preview.body.warnings.some((w) => w.code === 'TOPIC_EXPOSURE_CHANGE')).toBe(false); // gate는 지금 통과할 것

        const [restoreRes, disableRes] = await Promise.all([
          admin('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, { expectedCurrentHash: preview.body.currentContentHash }),
          admin('POST', `/chatbots/${chatbotId}/topics/${topic.id}/disable`),
        ]);
        lastStatuses = [restoreRes.status, disableRes.status];
        if (restoreRes.status === 409 && (restoreRes.body as { code?: string }).code === 'RESTORE_PREVIEW_STALE') {
          reproduced = true;
        }
      }
      if (!reproduced) {
        // 재현 실패 사유를 명확히 남긴다(오류검출_프로세스.md 결함 이력에 준하는 기록 — 최종 보고서에도 남긴다).
        throw new Error(
          `TOCTOU 경합을 5회 시도 안에 실제 HTTP 동시 요청으로 재현하지 못했습니다(마지막 상태: restore=${lastStatuses[0]}, disable=${lastStatuses[1]}). ` +
            '단위 시험(version-restore.service.spec.ts, exposureForGate/exposureInTx mock 경합)이 같은 로직을 결정적으로 커버합니다.',
        );
      }
      expect(reproduced).toBe(true);
    }, 30_000);
  });

  /* ============================================================================================
   * A.8 토픽 단위 내보내기
   * ========================================================================================== */
  describe('A.8 토픽 단위 내보내기', () => {
    it('topicIds 필터로 내보내면 해당 토픽 의도만 파일에 담긴다', async () => {
      const { id: chatbotId } = await createChatbot();
      const shipping = await createTopic(chatbotId, { name: '배송' });
      const refund = await createTopic(chatbotId, { name: '환불' });
      await createIntent(chatbotId, { name: '배송의도내보내기', examples: ['배송 예문'], topicId: shipping.id });
      await createIntent(chatbotId, { name: '환불의도내보내기', examples: ['환불 예문'], topicId: refund.id });

      const res = await admin<string>('GET', `/chatbots/${chatbotId}/intents/export?topicIds=${shipping.id}`);
      expect(res.status).toBe(200);
      const content = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      expect(content).toContain('배송의도내보내기');
      expect(content).not.toContain('환불의도내보내기');
    });
  });

  /* ============================================================================================
   * A.9 영구삭제 사전검사 14종 · 챗봇 복사와의 관계
   * ========================================================================================== */
  describe('A.9 영구삭제 사전검사·챗봇 복사', () => {
    it('토픽이 있는 챗봇을 영구삭제하려 하면 사전검사(14종)에 토픽이 걸린다', async () => {
      const { id: chatbotId, name } = await (async () => {
        const bot = await createChatbot({ name: `영구삭제대상-${Math.random().toString(36).slice(2, 8)}` });
        const detail = await admin<{ name: string }>('GET', `/chatbots/${bot.id}`);
        return { id: bot.id, name: detail.body.name };
      })();
      await createTopic(chatbotId, { name: '삭제확인토픽' });

      const archiveRes = await admin('DELETE', `/chatbots/${chatbotId}`);
      expect(archiveRes.status).toBe(204);

      const deleteRes = await admin<{ code: string; message: string }>('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: name });
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.code).toBe('CHATBOT_HAS_CHILDREN');
      expect(deleteRes.body.message).toContain('토픽');
    });

    it('EX-TP-22: 기존 챗봇 복사(copy)는 프로필만 복사하고 토픽·자산은 복사하지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const topic = await createTopic(chatbotId, { name: '복사원본토픽' });
      await createIntent(chatbotId, { name: '복사원본의도', examples: ['복사 원본 예문'], topicId: topic.id });

      const copyRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/copy`, {});
      expect(copyRes.status).toBe(201);
      const copiedId = copyRes.body.id;

      const topicsInCopy = await prisma.topic.count({ where: { chatbotId: copiedId } });
      const intentsInCopy = await prisma.intent.count({ where: { chatbotId: copiedId } });
      expect(topicsInCopy).toBe(0);
      expect(intentsInCopy).toBe(0);
    });
  });

  /* ============================================================================================
   * A.10 권한 매트릭스 — VIEWER·EDITOR·AGENT·ADMIN × 11개 엔드포인트, 비로그인 401
   * ========================================================================================== */
  describe('A.10 권한 매트릭스', () => {
    it('11개 토픽 엔드포인트에 대해 역할별 기대 상태 코드를 만족한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const topic = await createTopic(chatbotId, { name: '권한확인토픽' });
      const intentId = await createIntent(chatbotId, { name: '권한확인의도', examples: ['권한 확인'] });

      type Case = { label: string; call: (actor: typeof admin) => Promise<ApiResponse>; readOnly: boolean };
      const cases: Case[] = [
        { label: '① GET topics', call: (a) => a('GET', `/chatbots/${chatbotId}/topics`), readOnly: true },
        { label: '② POST topics', call: (a) => a('POST', `/chatbots/${chatbotId}/topics`, { name: `임시-${Math.random().toString(36).slice(2, 6)}` }), readOnly: false },
        { label: '③ POST split/preview', call: (a) => a('POST', `/chatbots/${chatbotId}/topics/split/preview`, { topicIds: [topic.id] }), readOnly: false },
        { label: '⑤ PATCH :id', call: (a) => a('PATCH', `/chatbots/${chatbotId}/topics/${topic.id}`, { description: '설명' }), readOnly: false },
        { label: '⑦ POST :id/move', call: (a) => a('POST', `/chatbots/${chatbotId}/topics/${topic.id}/move`, { direction: 'DOWN' }), readOnly: false },
        { label: '⑧ GET :id/impact', call: (a) => a('GET', `/chatbots/${chatbotId}/topics/${topic.id}/impact?action=DISABLE`), readOnly: true },
        { label: '⑨ POST :id/enable', call: (a) => a('POST', `/chatbots/${chatbotId}/topics/${topic.id}/enable`), readOnly: false },
        { label: '⑩ POST :id/disable', call: (a) => a('POST', `/chatbots/${chatbotId}/topics/${topic.id}/disable`), readOnly: false },
        { label: '⑪ POST topic-assignments', call: (a) => a('POST', `/chatbots/${chatbotId}/topic-assignments`, { kind: 'INTENT', ids: [intentId], topicId: topic.id }), readOnly: false },
      ];

      for (const c of cases) {
        const viewerRes = await c.call(viewer);
        expect([c.label, viewerRes.status]).toEqual([c.label, c.readOnly ? 200 : 403]);
        const agentRes = await c.call(agent);
        expect([c.label, agentRes.status]).toEqual([c.label, 403]);
        const adminRes = await c.call(admin);
        expect([c.label, adminRes.status]).toEqual([c.label, adminRes.status < 300 ? adminRes.status : 200]);
        expect([c.label, adminRes.status < 400]).toEqual([c.label, true]);
      }

      // ④/⑥ 별도(자산·삭제 대상이 소진되므로 새 토픽으로 각각 확인).
      const forSplit = await createTopic(chatbotId, { name: '분리권한확인' });
      const viewerSplit = await viewer('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [forSplit.id] });
      expect(viewerSplit.status).toBe(403);
      const agentSplit = await agent('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [forSplit.id] });
      expect(agentSplit.status).toBe(403);

      const forDelete = await createTopic(chatbotId, { name: '삭제권한확인' });
      const viewerDelete = await viewer('DELETE', `/chatbots/${chatbotId}/topics/${forDelete.id}`);
      expect(viewerDelete.status).toBe(403);
      const agentDelete = await agent('DELETE', `/chatbots/${chatbotId}/topics/${forDelete.id}`);
      expect(agentDelete.status).toBe(403);
      const adminDelete = await admin('DELETE', `/chatbots/${chatbotId}/topics/${forDelete.id}`);
      expect(adminDelete.status).toBe(204);
    }, 30_000);

    it('비로그인은 전부 401이다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await anon('GET', `/chatbots/${chatbotId}/topics`);
      expect(res.status).toBe(401);
      const res2 = await anon('POST', `/chatbots/${chatbotId}/topics`, { name: 'x' });
      expect(res2.status).toBe(401);
    });
  });

  /* ============================================================================================
   * B. K-1 회귀(§21.3) — 번들 결정적 정렬
   * ========================================================================================== */
  describe('B. K-1 회귀 — 번들 조회 결정적 정렬', () => {
    it('동일 예문 의도 2개(A→B 순서 생성) — 번들 정렬 [createdAt asc, id asc]로 A가 이긴다(수정해도)', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentA = await createIntent(chatbotId, { name: 'K1-A', examples: ['동점 예문'] });
      await new Promise((r) => setTimeout(r, 15));
      const intentB = await createIntent(chatbotId, { name: 'K1-B', examples: ['동점 예문'] });
      await createNode(chatbotId, { name: 'K1-A노드', intentIds: [intentA], outputs: [{ type: 'TEXT', payload: { text: 'A노드 응답' } }] });
      await createNode(chatbotId, { name: 'K1-B노드', intentIds: [intentB], outputs: [{ type: 'TEXT', payload: { text: 'B노드 응답' } }] });

      // A를 수정해 updatedAt을 올려도(§12.2 — createdAt 기준 정렬이라 흔들리지 않아야 한다).
      await admin('PATCH', `/chatbots/${chatbotId}/intents/${intentA}`, { description: '수정됨' });

      const sim = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${chatbotId}/simulate`, { message: '동점 예문' });
      expect(sim.body.outputs[0]?.payload.text).toBe('A노드 응답');
    });

    it('버전 캡처 → 복원 후에도 동점 승자가 같다', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentA = await createIntent(chatbotId, { name: 'K1V-A', examples: ['K1 복원 동점'] });
      await new Promise((r) => setTimeout(r, 15));
      const intentB = await createIntent(chatbotId, { name: 'K1V-B', examples: ['K1 복원 동점'] });
      const nodeBId = await createNode(chatbotId, { name: 'K1V-B노드', intentIds: [intentB], outputs: [{ type: 'TEXT', payload: { text: 'B 응답' } }] });
      await createNode(chatbotId, { name: 'K1V-A노드', intentIds: [intentA], outputs: [{ type: 'TEXT', payload: { text: 'A 응답' } }] });

      const before = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${chatbotId}/simulate`, { message: 'K1 복원 동점' });
      expect(before.body.outputs[0]?.payload.text).toBe('A 응답');

      const v1res = await admin<{ version: { id: string } }>('POST', `/chatbots/${chatbotId}/versions`, { label: 'k1-v1' });
      const versionId = v1res.body.version.id;

      // B를 참조하는 노드부터 지우고(참조 무결성) 의도 B도 지운다 — 복원이 원래 id·createdAt으로
      // 되살리는지 확인한다(§12 — 복원이 createdAt을 보존하므로 승자는 그대로여야 한다).
      const deleteNodeRes = await admin('DELETE', `/chatbots/${chatbotId}/dialog-nodes/${nodeBId}`);
      expect(deleteNodeRes.status).toBe(204);
      const deleteIntentRes = await admin('DELETE', `/chatbots/${chatbotId}/intents/${intentB}`);
      expect(deleteIntentRes.status).toBe(204);

      const previewRes = await admin<{ currentContentHash: string; blockers: unknown[] }>('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore/preview`, {});
      expect(previewRes.body.blockers).toEqual([]);
      const restoreRes = await admin('POST', `/chatbots/${chatbotId}/versions/${versionId}/restore`, { expectedCurrentHash: previewRes.body.currentContentHash });
      expect(restoreRes.status).toBe(200);

      const after = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${chatbotId}/simulate`, { message: 'K1 복원 동점' });
      expect(after.body.outputs[0]?.payload.text).toBe('A 응답');
    });

    it('분리본에서도 동점 승자가 같다(AC-TP5-4와 동일 메커니즘의 재확인)', async () => {
      const { id: chatbotId } = await createChatbot();
      await createNode(chatbotId, { name: 'K1S-시작', nodeType: 'START', outputs: [{ type: 'TEXT', payload: { text: '안녕' } }] });
      await createNode(chatbotId, { name: 'K1S-폴백', nodeType: 'FALLBACK', outputs: [{ type: 'TEXT', payload: { text: '폴백' } }] });
      const topic = await createTopic(chatbotId, { name: 'K1분리토픽' });
      const intentA = await createIntent(chatbotId, { name: 'K1S-A', examples: ['분리 동점'], topicId: topic.id });
      await new Promise((r) => setTimeout(r, 15));
      const intentB = await createIntent(chatbotId, { name: 'K1S-B', examples: ['분리 동점'], topicId: topic.id });
      await createNode(chatbotId, { name: 'K1S-A노드', intentIds: [intentA], outputs: [{ type: 'TEXT', payload: { text: 'A 응답' } }], topicId: topic.id });
      await createNode(chatbotId, { name: 'K1S-B노드', intentIds: [intentB], outputs: [{ type: 'TEXT', payload: { text: 'B 응답' } }], topicId: topic.id });

      const splitRes = await admin<{ chatbot: { id: string } }>('POST', `/chatbots/${chatbotId}/topics/split`, { topicIds: [topic.id] });
      const newChatbotId = splitRes.body.chatbot.id;
      const sim = await admin<{ outputs: Array<{ payload: { text: string } }> }>('POST', `/chatbots/${newChatbotId}/simulate`, { message: '분리 동점' });
      expect(sim.body.outputs[0]?.payload.text).toBe('A 응답');
    });

    /**
     * TestRun A/B + test-runs/compare — §21.3 절차 3번. 동점 케이스 TC 1건 + 비동점 TC 1건을 만들어
     * 실행 2회(A: 대조군 성격 · B: 회귀 확인)를 비교한다. K-1은 이미 코드에 적용된 상태로만 시험
     * 가능하다(별도 "적용 전" 빌드가 없다 — §21.3 5번 "운영 데이터가 있는 설치본은 배포 전 반복" 절차는
     * `docs/05-ops/자동배포.md` 인계 사항으로 문서화만 한다). 이 시험은 "같은 TC 세트를 두 번 실행하면
     * 결과가 같다(변화 0)"는 결정성 자체를 검증해 K-1 정렬이 실행마다 흔들리지 않음을 보인다.
     */
    it('TestRun A/B 비교 — 같은 TC 세트를 두 번 실행하면 차이가 0건이다(결정성)', async () => {
      const { id: chatbotId } = await createChatbot();
      const intentA = await createIntent(chatbotId, { name: 'K1T-A', examples: ['비교 동점'] });
      await new Promise((r) => setTimeout(r, 15));
      const intentB = await createIntent(chatbotId, { name: 'K1T-B', examples: ['비교 동점'] });
      await createNode(chatbotId, { name: 'K1T-A노드', intentIds: [intentA], outputs: [{ type: 'TEXT', payload: { text: 'A 응답' } }] });
      await createNode(chatbotId, { name: 'K1T-B노드', intentIds: [intentB], outputs: [{ type: 'TEXT', payload: { text: 'B 응답' } }] });

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: 'K1 회귀 세트' });
      const setId = setRes.body.id;
      await admin('POST', `/chatbots/${chatbotId}/test-sets/${setId}/cases`, { messages: ['비교 동점'], expectedKind: 'INTENT', expectedTargetId: intentA });

      const runA = await admin<{ runId: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/runs`, { overlaySource: 'NONE', useRag: false });
      const runAId = runA.body.runId;
      await pollUntil(
        () => admin<{ status: string }>('GET', `/chatbots/${chatbotId}/test-runs/${runAId}`),
        (r) => r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED',
        { maxWaitMs: 10_000, label: 'TestRun A 완료' },
      );

      const runB = await admin<{ runId: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/runs`, { overlaySource: 'NONE', useRag: false });
      const runBId = runB.body.runId;
      await pollUntil(
        () => admin<{ status: string }>('GET', `/chatbots/${chatbotId}/test-runs/${runBId}`),
        (r) => r.body.status === 'SUCCEEDED' || r.body.status === 'FAILED',
        { maxWaitMs: 10_000, label: 'TestRun B 완료' },
      );

      const compare = await admin<{ counts: { REGRESSED: number; CHANGED: number } }>('GET', `/chatbots/${chatbotId}/test-runs/compare?baseRunId=${runAId}&targetRunId=${runBId}`);
      expect(compare.status).toBe(200);
      expect(compare.body.counts.REGRESSED).toBe(0);
      expect(compare.body.counts.CHANGED).toBe(0);
    }, 30_000);
  });
});
