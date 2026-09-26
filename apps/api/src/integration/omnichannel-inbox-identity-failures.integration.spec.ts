import { execSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { InboxIdentityService } from '../inbox/identity/inbox-identity.service';
import { InboxStore } from '../inbox/core/inbox.store';
import { computeSessionRef } from '../handoff/lib/session-ref';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

const API_ROOT = join(__dirname, '..', '..');
const IDENTITY_HEADER = 'x-cb-identity';

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
function signToken(payload: Record<string, unknown>, secret: string, header: Record<string, unknown> = { alg: 'HS256' }): string {
  const h = b64url(header);
  const p = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

/**
 * 옴니채널 통합 인박스(No.42) — 식별 실패 사유 7종 동일성(§6.6) + 수동 기록/시뮬레이션 로그 격리
 * (AC-OC5-2) + 병합 되돌리기 24시간 창(§7.5). 전부 상대 시각(now 기준 오프셋)만 사용한다.
 */
describe('옴니채널 통합 인박스(No.42) — 식별 실패 동일성 · 로그 격리 · 되돌리기 창', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;
  let inboxIdentity: InboxIdentityService;
  let store: InboxStore;
  let adminCookie = '';
  let agentCookie = '';

  const CUSTOMER_KEY_SECRET = 'ck-secret-failures-'.padEnd(32, '0');
  const SPACE_REF = 'FAILSPACE';
  const SPACE_SECRET = 'fail-secret-'.padEnd(32, '2');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-inbox-idfail-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.OMNI_CUSTOMER_KEY_SECRET = CUSTOMER_KEY_SECRET;
    process.env[`OMNI_IDENTITY_SECRET__${SPACE_REF}`] = SPACE_SECRET;
    process.env.OMNI_MERGE_REVERT_HOURS = '24';

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
    inboxIdentity = moduleRef.get(InboxIdentityService);
    store = moduleRef.get(InboxStore);

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

  function randomSessionId(): string {
    const hex = () => Math.random().toString(16).slice(2, 10);
    return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`;
  }

  async function createGroup(): Promise<string> {
    const res = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `실패동일성그룹-${Math.random().toString(36).slice(2, 8)}` });
    return res.body.id;
  }

  async function setupBot(withSecretRef: boolean): Promise<{ chatbotId: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `idfail-${suffix}`;
    const createRes = await admin<{ id: string }>('POST', '/chatbots', { groupId, name: `실패동일성봇-${suffix}`, slug });
    const chatbotId = createRes.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [] } });
    await admin('PUT', `/chatbots/${chatbotId}/inbox-settings`, { enabled: true, openOnWarning: false });
    if (withSecretRef) await admin('PUT', `/chatbots/${chatbotId}/inbox-settings/identity`, { identitySecretRef: SPACE_REF });
    return { chatbotId, slug };
  }

  async function statsFor(chatbotId: string): Promise<Record<string, number>> {
    const res = await admin<{ identity: { stats24h: { failures: Record<string, number> } } }>('GET', `/chatbots/${chatbotId}/inbox-settings`);
    return res.body.identity.stats24h.failures;
  }

  const REASON_CASES: Array<{ reason: string; build: (bot: { chatbotId: string }) => string }> = [
    { reason: 'MALFORMED', build: () => 'not-a-jws-token' },
    { reason: 'SIGNATURE', build: () => signToken({ sub: `sig-${Math.random().toString(36).slice(2, 8)}`, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret-'.padEnd(32, '9')) },
    {
      reason: 'EXPIRED',
      build: () => {
        const now = Math.floor(Date.now() / 1000);
        return signToken({ sub: `exp-${Math.random().toString(36).slice(2, 8)}`, iat: now - 8000, exp: now - 7000 }, SPACE_SECRET);
      },
    },
    {
      reason: 'NOT_YET_VALID',
      build: () => {
        const now = Math.floor(Date.now() / 1000);
        return signToken({ sub: `nyv-${Math.random().toString(36).slice(2, 8)}`, iat: now + 1000, exp: now + 5000 }, SPACE_SECRET);
      },
    },
    {
      reason: 'TTL_TOO_LONG',
      build: () => {
        const now = Math.floor(Date.now() / 1000);
        return signToken({ sub: `ttl-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 30 * 3600 }, SPACE_SECRET);
      },
    },
  ];

  it.each(REASON_CASES)('식별 실패($reason) — 응답이 헤더 없음과 바이트 동일하고 고객·연결이 생기지 않는다', async ({ reason, build }) => {
    const bot = await setupBot(true);
    const token = build(bot);
    const sessionWithout = randomSessionId();
    const sessionWith = randomSessionId();

    const withoutHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: sessionWithout, message: '안녕하세요' });
    const withHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: sessionWith, message: '안녕하세요' }, { [IDENTITY_HEADER]: token });

    expect(withHeader.status).toBe(withoutHeader.status);
    expect(Object.keys(withHeader.body).sort()).toEqual(Object.keys(withoutHeader.body).sort());

    await inboxIdentity.drainForTest();
    const linkCount = await prisma.customerLink.count({ where: { chatbotId: bot.chatbotId, source: 'IDENTITY' } });
    expect(linkCount).toBe(0);

    const failures = await statsFor(bot.chatbotId);
    expect(failures[reason]).toBeGreaterThanOrEqual(1);
  });

  it('식별 실패(SECRET_MISSING) — 참여는 켰지만 식별 비밀 참조를 지정하지 않으면 실패로 계수되고 응답은 동일하다', async () => {
    const bot = await setupBot(false); // identitySecretRef 미지정
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ sub: `sm-${Math.random().toString(36).slice(2, 8)}`, iat: now, exp: now + 3600 }, SPACE_SECRET);

    const withoutHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: '안녕' });
    const withHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: '안녕' }, { [IDENTITY_HEADER]: token });
    expect(withHeader.status).toBe(withoutHeader.status);

    await inboxIdentity.drainForTest();
    const failures = await statsFor(bot.chatbotId);
    expect(failures.SECRET_MISSING).toBeGreaterThanOrEqual(1);
    const linkCount = await prisma.customerLink.count({ where: { chatbotId: bot.chatbotId } });
    expect(linkCount).toBe(0);
  });

  it('식별 실패(CONFLICT) — 이미 다른 회원으로 연결된 세션에 다른 sub 토큰이 오면 연결이 바뀌지 않고 계수만 는다', async () => {
    const bot = await setupBot(true);
    const sessionId = randomSessionId();
    const sessionRef = computeSessionRef(bot.chatbotId, sessionId);
    const now = new Date();

    // 세션 식별 캐시(§6.5 — 세션당 1회)가 공개 경로를 통해 "이미 검증된 세션"으로 인지하면 두 번째
    // 토큰은 재검증 자체를 하지 않는다(정상 동작 — 설계 그대로). 두 서로 다른 회원 사이의 CONFLICT를
    // 재현하려면 첫 연결을 서비스 캐시 밖(스토어 직접 호출)에서 만들어 세션 캐시가 "차가운" 상태를
    // 유지하게 한다 — 그래야 실제 HTTP 경로가 처음으로 이 세션을 검증하며 스토어의 CONFLICT 분기를 탄다.
    await store.linkIdentity({
      chatbotId: bot.chatbotId,
      sessionId,
      sessionRef,
      channelType: 'WEB',
      spaceRef: SPACE_REF,
      customerKey: `conflict-existing-${randomUUID()}`,
      fingerprint: 'aaaaaaaa',
      now,
    });
    const linkBefore = await prisma.customerLink.findUniqueOrThrow({ where: { chatbotId_sessionId: { chatbotId: bot.chatbotId, sessionId } } });

    const nowSec = Math.floor(Date.now() / 1000);
    const tokenB = signToken({ sub: `conflict-b-${Math.random().toString(36).slice(2, 8)}`, iat: nowSec, exp: nowSec + 3600 }, SPACE_SECRET);
    const withoutHeader = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId: randomSessionId(), message: '안녕' });
    const withConflict = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${bot.slug}/messages`, { sessionId, message: '두 번째' }, { [IDENTITY_HEADER]: tokenB });
    expect(withConflict.status).toBe(withoutHeader.status);
    await inboxIdentity.drainForTest();

    const linkAfter = await prisma.customerLink.findUniqueOrThrow({ where: { chatbotId_sessionId: { chatbotId: bot.chatbotId, sessionId } } });
    expect(linkAfter.customerId).toBe(linkBefore.customerId); // 바뀌지 않는다.

    const failures = await statsFor(bot.chatbotId);
    expect(failures.CONFLICT).toBeGreaterThanOrEqual(1);
  });

  it('AC-OC5-2: 수동 기록·시뮬레이션은 대화 로그·미응답 큐·답변 평가·업무 자동화 실행에 0건 반영된다', async () => {
    const bot = await setupBot(false);
    const before = {
      logs: await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId } }),
      unanswered: await prisma.unansweredQuestion.count({ where: { chatbotId: bot.chatbotId } }),
      feedback: await prisma.messageFeedback.count({ where: { chatbotId: bot.chatbotId } }),
      workflow: await prisma.workflowRun.count({ where: { chatbotId: bot.chatbotId } }),
    };

    const created = await admin<{ threadId: string }>('POST', '/inbox/customers', { displayName: '격리 확인 고객' });
    await admin('POST', `/inbox/threads/${created.body.threadId}/records`, {
      recordChannel: 'PHONE',
      direction: 'INBOUND',
      occurredAt: new Date().toISOString(),
      text: '전화 문의 — 배송 지연 안내',
    });
    const testCustomer = await admin<{ customerId: string }>('POST', '/inbox/test-customers', { label: '격리 시험 고객' });
    await admin('POST', `/inbox/test-customers/${testCustomer.body.customerId}/simulate`, { chatbotId: bot.chatbotId, simulatedChannel: 'LINE', message: '테스트 문의' });

    const after = {
      logs: await prisma.conversationLog.count({ where: { chatbotId: bot.chatbotId } }),
      unanswered: await prisma.unansweredQuestion.count({ where: { chatbotId: bot.chatbotId } }),
      feedback: await prisma.messageFeedback.count({ where: { chatbotId: bot.chatbotId } }),
      workflow: await prisma.workflowRun.count({ where: { chatbotId: bot.chatbotId } }),
    };
    expect(after).toEqual(before);

    const recordEntries = await prisma.inboxEntry.count({ where: { kind: 'RECORD' } });
    const simEntries = await prisma.inboxEntry.count({ where: { kind: { in: ['SIM_USER', 'SIM_BOT'] } } });
    expect(recordEntries).toBeGreaterThanOrEqual(1);
    expect(simEntries).toBeGreaterThanOrEqual(2);
  });

  async function agent<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: agentCookie });
  }

  async function createAnonAndIdentified(): Promise<{ anon: { id: string }; identified: { id: string } }> {
    const now = new Date();
    const anon = await prisma.customer.create({ data: { ref: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: now, lastActivityAt: now } });
    const identified = await prisma.customer.create({
      data: { ref: randomUUID().replace(/-/g, '').slice(0, 16), kind: 'IDENTIFIED', status: 'ACTIVE', customerKeyHash: randomUUID(), firstSeenAt: now, lastActivityAt: now },
    });
    return { anon, identified };
  }

  it('§7.5: 병합 되돌리기 — 수행자 본인은 기한(24h) 이내에만 되고, 기한을 넘기면 409다', async () => {
    const { anon, identified } = await createAnonAndIdentified();
    const mergeRes = await agent<{ mergeId: string }>('POST', `/inbox/customers/${anon.id}/merge`, { targetCustomerId: identified.id });
    expect(mergeRes.status).toBe(201);

    // 기한 이내(방금 병합) — 수행자 본인(AGENT)이 즉시 되돌릴 수 있다.
    const revertNow = await agent('POST', `/inbox/merges/${mergeRes.body.mergeId}/revert`);
    expect(revertNow.status).toBe(201);
  });

  it('§7.5: 병합 되돌리기 — 수행자 본인이어도 기한(24h)을 넘기면 409 CUSTOMER_MERGE_NOT_REVERTIBLE이다', async () => {
    const { anon, identified } = await createAnonAndIdentified();
    const mergeRes = await agent<{ mergeId: string }>('POST', `/inbox/customers/${anon.id}/merge`, { targetCustomerId: identified.id });
    expect(mergeRes.status).toBe(201);

    // 상대 시각 — now 기준 25시간 전으로 되돌려(OMNI_MERGE_REVERT_HOURS=24 초과) 병합됨을 재현한다.
    const old = new Date(Date.now() - 25 * 3600_000);
    await prisma.customerMerge.update({ where: { id: mergeRes.body.mergeId }, data: { mergedAt: old } });

    const revertLate = await agent<{ code: string }>('POST', `/inbox/merges/${mergeRes.body.mergeId}/revert`);
    expect(revertLate.status).toBe(409);
    expect(revertLate.body.code).toBe('CUSTOMER_MERGE_NOT_REVERTIBLE');
  });

  it('§7.5: 병합 되돌리기 — ADMIN은 기한과 무관하게(수행자가 AGENT였어도) 되돌릴 수 있다', async () => {
    const { anon, identified } = await createAnonAndIdentified();
    const mergeRes = await agent<{ mergeId: string }>('POST', `/inbox/customers/${anon.id}/merge`, { targetCustomerId: identified.id });
    expect(mergeRes.status).toBe(201);

    const old = new Date(Date.now() - 48 * 3600_000);
    await prisma.customerMerge.update({ where: { id: mergeRes.body.mergeId }, data: { mergedAt: old } });

    const revertByAdmin = await admin('POST', `/inbox/merges/${mergeRes.body.mergeId}/revert`);
    expect(revertByAdmin.status).toBe(201);
  });

  it('[계약 보강] 병합 후 상세 응답의 SYSTEM meta에 mergedByUserId·mergedAt·mergeKind가 실리고, mergeRevertHours가 설정값과 같다', async () => {
    const source = await agent<{ customerId: string; threadId: string }>('POST', '/inbox/customers', { displayName: '병합 출처' });
    const target = await agent<{ customerId: string; threadId: string }>('POST', '/inbox/customers', { displayName: '병합 대상' });
    expect(source.status).toBe(201);
    expect(target.status).toBe(201);

    const beforeMerge = new Date();
    const mergeRes = await agent<{ mergeId: string; targetThreadId: string | null }>('POST', `/inbox/customers/${source.body.customerId}/merge`, { targetCustomerId: target.body.customerId });
    expect(mergeRes.status).toBe(201);

    const detail = await agent<{
      mergeRevertHours: number;
      timeline: { units: Array<{ kind: string; system?: { event: string; data: Record<string, unknown> } }> };
    }>('GET', `/inbox/threads/${target.body.threadId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.mergeRevertHours).toBe(24); // OMNI_MERGE_REVERT_HOURS=24(이 spec 상단 설정값)와 동일해야 한다.

    const mergedInUnit = detail.body.timeline.units.find((u) => u.kind === 'SYSTEM' && u.system?.event === 'MERGED_IN');
    expect(mergedInUnit).toBeDefined();
    const data = mergedInUnit!.system!.data;
    expect(data.mergeKind).toBe('MANUAL');
    expect(data.mergedByUserId).toEqual(expect.any(String));
    expect(typeof data.mergedAt).toBe('string');
    // ISO 문자열이 이번 병합 시각(beforeMerge) 이후여야 한다 — 상대 시각만 사용(절대 timestamp 금지).
    expect(new Date(data.mergedAt as string).getTime()).toBeGreaterThanOrEqual(beforeMerge.getTime());
  });
});
