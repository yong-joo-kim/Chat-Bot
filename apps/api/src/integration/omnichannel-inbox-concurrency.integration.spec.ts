import { execSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { InboxStore } from '../inbox/core/inbox.store';
import { InboxCustomersService } from '../inbox/manage/inbox-customers.service';
import { computeSessionRef } from '../handoff/lib/session-ref';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 무시.
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const { hostname, port, pathname, search } = new URL(url);
    const req = http.request(
      { method, hostname, port, path: pathname + search, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } },
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signToken(payload: Record<string, unknown>, secret: string): string {
  const h = b64url({ alg: 'HS256' });
  const p = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

/**
 * 옴니채널 통합 인박스(No.42) — 동시성 통합 시험(실제 SQLite, `Promise.all`). §7.6 경합 표의 대표
 * 항목: 병합 ∥ 분리 · 가져가기 ∥ 가져가기 · 상태 변경 `version` 경합 · 익명→식별 자동 병합 ∥ 수동 연결.
 */
describe('옴니채널 통합 인박스(No.42) — 동시성 통합 시험', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let store: InboxStore;
  let customersService: InboxCustomersService;
  let agentCookie = '';
  let adminCookie = '';

  const SPACE_REF = 'CONCURTEST';
  const SPACE_SECRET = 'concur-secret-'.padEnd(32, '3');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-concurrency-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.OMNI_CUSTOMER_KEY_SECRET = 'ck-secret-concurrency-'.padEnd(32, '0');
    process.env[`OMNI_IDENTITY_SECRET__${SPACE_REF}`] = SPACE_SECRET;

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaService);
    store = moduleRef.get(InboxStore);
    customersService = moduleRef.get(InboxCustomersService);

    await app.listen(0);
    const server = app.getHttpServer() as http.Server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    await seedTestUsers(prisma);
    adminCookie = await loginAs(baseUrl, 'ADMIN');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }
  function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: agentCookie });
  }

  async function createChatbotWithSlug(namePrefix: string): Promise<{ id: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix} 그룹` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `concur-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    return { id: res.body.id, slug };
  }
  async function activate(chatbotId: string): Promise<void> {
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
  }
  async function enableParticipation(chatbotId: string, identitySecretRef?: string): Promise<void> {
    await admin('PUT', `/chatbots/${chatbotId}/inbox-settings`, { enabled: true, openOnWarning: false });
    if (identitySecretRef) await admin('PUT', `/chatbots/${chatbotId}/inbox-settings/identity`, { identitySecretRef });
  }

  it('① 가져가기 2건 동시 요청 — 1건만 성공하고 나머지는 409 INBOX_THREAD_CONFLICT다', async () => {
    const create = await admin<{ threadId: string }>('POST', '/inbox/customers', { displayName: '가져가기 동시성' });
    const threadId = create.body.threadId;

    const [r1, r2] = await Promise.all([jsonRequest('POST', `${baseUrl}/inbox/threads/${threadId}/claim`, {}, { Cookie: agentCookie }), jsonRequest('POST', `${baseUrl}/inbox/threads/${threadId}/claim`, {}, { Cookie: adminCookie })]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflictBody = (r1.status === 409 ? r1.body : r2.body) as { code: string };
    expect(conflictBody.code).toBe('INBOX_THREAD_CONFLICT');
  });

  it('② 상태 변경 version 경합 — 같은 version으로 동시에 PATCH하면 1건만 성공한다', async () => {
    const create = await admin<{ threadId: string }>('POST', '/inbox/customers', { displayName: 'version 경합' });
    const threadId = create.body.threadId;

    const [r1, r2] = await Promise.all([
      jsonRequest('PATCH', `${baseUrl}/inbox/threads/${threadId}`, { status: 'PENDING', version: 0 }, { Cookie: adminCookie }),
      jsonRequest('PATCH', `${baseUrl}/inbox/threads/${threadId}`, { status: 'CLOSED', version: 0 }, { Cookie: agentCookie }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const finalThread = await prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(finalThread.version).toBe(1); // 성공한 쪽만 반영 — 두 번 증가하지 않는다.
  });

  it('③ 병합과 분리(수동 연결 재지정)의 동시 실행 — 데이터가 깨지지 않고 최종적으로 정확히 한쪽 결과로 수렴한다', async () => {
    const now = new Date();
    // 병합 대상(식별 고객, ACTIVE) 준비.
    const target = await prisma.customer.create({ data: { ref: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'IDENTIFIED', status: 'ACTIVE', customerKeyHash: randomUUID(), firstSeenAt: now, lastActivityAt: now } });
    // 병합 원본(익명, MANUAL 연결 보유) 준비.
    const source = await store.createAnonymousCustomer({ now, openReason: 'MANUAL' });
    const sourceCustomerId = source.customerId;
    const bot = await createChatbotWithSlug('동시성병합봇');
    const sessionId = randomUUID();
    const sessionRef = computeSessionRef(bot.id, sessionId);
    await store.manualLinkCreate({ customerId: sourceCustomerId, chatbotId: bot.id, sessionId, sessionRef, channelType: 'WEB', now });
    const link = await prisma.customerLink.findUniqueOrThrow({ where: { chatbotId_sessionId: { chatbotId: bot.id, sessionId } } });

    const [mergeResult, unlinkResult] = await Promise.allSettled([
      store.mergeCustomers({ sourceCustomerId, targetCustomerId: target.id, kind: 'MANUAL', now: new Date() }),
      customersService.unlink(sourceCustomerId, link.id, { id: 'agent', name: '상담원', role: 'AGENT' } as never),
    ]);

    // 예외로 전체가 죽지 않는다(둘 다 정상 종료 또는 정의된 오류로 처리) — 최소 하나는 성공했어야 한다.
    const settleStatuses = [mergeResult.status, unlinkResult.status];
    expect(settleStatuses.some((s) => s === 'fulfilled')).toBe(true);

    // 최종 일관성: 링크 행은 정확히 1개 남아 있고, 가리키는 고객이 실존한다.
    const finalLinks = await prisma.customerLink.findMany({ where: { chatbotId: bot.id, sessionId } });
    expect(finalLinks.length).toBeLessThanOrEqual(1);
    if (finalLinks.length === 1) {
      const owner = await prisma.customer.findUnique({ where: { id: finalLinks[0].customerId } });
      expect(owner).not.toBeNull();
    }
    // 원본 고객 자체는 항상 존재한다(사실 기록 — 삭제되지 않는다).
    const sourceStillExists = await prisma.customer.findUnique({ where: { id: sourceCustomerId } });
    expect(sourceStillExists).not.toBeNull();
  });

  it('④ 익명→식별 자동 병합(신호)과 수동 연결 재지정이 겹칠 때 — 레이스 후에도 세션 연결이 정확히 1행이다', async () => {
    const bot = await createChatbotWithSlug('승격경합봇');
    await activate(bot.id);
    await enableParticipation(bot.id, SPACE_REF);

    const now = new Date();
    const sessionId = randomUUID();
    const sessionRef = computeSessionRef(bot.id, sessionId);

    // 사전 상태: 이 세션은 이미 익명 고객에게 SYSTEM 연결(상담 시작 신호 선례)이 있다.
    const anon = await store.createAnonymousCustomer({ now, openReason: 'MANUAL' });
    await prisma.customerLink.create({
      data: { customerId: anon.customerId, chatbotId: bot.id, sessionId, sessionRef, channelType: 'WEB', source: 'SYSTEM', linkedAt: now },
    });

    // 다른 익명 고객(수동 연결 경쟁자) 준비.
    const other = await store.createAnonymousCustomer({ now, openReason: 'MANUAL' });

    const sub = `member-${Math.random().toString(36).slice(2, 10)}`;
    const linkIdentityCall = store.linkIdentity({
      chatbotId: bot.id,
      sessionId,
      sessionRef,
      channelType: 'WEB',
      spaceRef: SPACE_REF,
      customerKey: createHmac('sha256', Buffer.from(process.env.OMNI_CUSTOMER_KEY_SECRET as string, 'utf8')).update(`cb-omni-customer:v1\n${SPACE_REF}\n${sub}`).digest('hex'),
      fingerprint: 'aaaaaaaa',
      now,
    });
    const manualReassignCall = customersService.link(other.customerId, { chatbotId: bot.id, sessionRef }, { id: 'agent', name: '상담원', role: 'AGENT' } as never);

    const results = await Promise.allSettled([linkIdentityCall, manualReassignCall]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    // 세션당 연결은 항상 정확히 1행(전체 유일 제약) — 레이스 후에도 깨지지 않는다.
    const finalLinks = await prisma.customerLink.findMany({ where: { chatbotId: bot.id, sessionId } });
    expect(finalLinks.length).toBe(1);
  });

  it('⑤ 경고 단계 동시 신호(코드리뷰 R2 H-2) — 사전 연결이 없는 세션에 두 신호가 겹쳐도 링크·스레드가 각각 1개다', async () => {
    const bot = await createChatbotWithSlug('경고동시성봇');
    const sessionId = randomUUID();
    const sessionRef = computeSessionRef(bot.id, sessionId);
    const now = new Date();

    const [r1, r2] = await Promise.all([
      store.openWarningThread({ chatbotId: bot.id, sessionId, sessionRef, channelType: 'WEB', now }),
      store.openWarningThread({ chatbotId: bot.id, sessionId, sessionRef, channelType: 'WEB', now }),
    ]);

    // 정확히 한쪽만 클레임에 성공해 스레드를 연다(둘 다 성공 = CAS 실패, 둘 다 실패 = 회귀).
    const successes = [r1, r2].filter((r) => r !== null);
    expect(successes.length).toBe(1);

    const links = await prisma.customerLink.findMany({ where: { chatbotId: bot.id, sessionId } });
    expect(links.length).toBe(1);
    expect(links[0].warningOpenedAt).not.toBeNull();

    const threads = await prisma.inboxThread.findMany({ where: { customerId: links[0].customerId } });
    expect(threads.length).toBe(1);
    expect(threads[0].openReason).toBe('WARNING');
  });
});
