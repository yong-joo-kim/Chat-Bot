import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 선제적(Proactive) 메시징(No.35) 통합 시험 — `proactive-messaging-설계.md` §16 · AC-PA1~PA9 대비.
 * 순수 함수 판정은 `proactive/lib/*.spec.ts`가 커버한다 — 이 파일은 HTTP 계약 레벨(관리 API CRUD·
 * 공개 조회 확장·바이트 동일 골든·수집·레이트리밋·감사·노드 유효성 필터링)을 다룬다.
 *
 * 레이트리밋 세션 한도를 낮춰(`PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_SESSION_PER_MIN=3`) 429 시험 비용을
 * 줄인다 — `CLAUDE.md` 규약대로 값을 먼저 설정한 뒤 동적 import로 AppModule을 로드한다.
 */

const API_ROOT = join(__dirname, '..', '..');

async function safeCleanupTmpDir(dir: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 정리 실패는 판정에 영향 없음(Windows 파일 핸들 지연 해제).
  }
}

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
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
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers, rawBody: data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('선제적(Proactive) 메시징(No.35) 통합 시험', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  let viewerCookie: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'proactive-messaging-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    // 선제 안내 수집 세션 버킷을 5/분으로 낮춰 429 시험 비용을 줄인다(기본 20/분) — AC-PA5-4가
    // 같은 (session,rule,SHOWN)을 5번 보내야 하므로 5보다 작게 두지 않는다.
    process.env.PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_SESSION_PER_MIN = '5';

    try {
      execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: testDatabaseUrl }, stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
    }

    const { AppModule } = await import('../app.module');
    const { PrismaService: PrismaServiceClass } = await import('../prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = moduleRef.get(PrismaServiceClass);

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
    await safeCleanupTmpDir(tmpDir);
  });

  const admin = <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  const viewer = <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: viewerCookie });
  const publicReq = <T = unknown>(method: string, path: string, body?: unknown) => jsonRequest<T>(method, `${baseUrl}${path}`, body);

  async function createChatbot(): Promise<{ chatbotId: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `선제안내테스트그룹 ${randomUUID().slice(0, 8)}` });
    const suffix = randomUUID().slice(0, 8);
    const slug = `pa-bot-${suffix}`;
    const createRes = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: '선제안내테스트봇', slug });
    const chatbotId = createRes.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕하세요' } });
    return { chatbotId, slug };
  }

  async function createEnabledNode(chatbotId: string, name = `노드-${randomUUID().slice(0, 6)}`): Promise<string> {
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name,
      nodeType: 'FALLBACK',
      outputs: [{ type: 'TEXT', payload: { text: '안내드립니다.' } }],
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  function pageDwellRuleBody(overrides: Record<string, unknown> = {}) {
    return {
      name: `규칙-${randomUUID().slice(0, 8)}`,
      trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 30 },
      text: '주문·배송 조회를 도와드릴까요?',
      buttons: [],
      devices: ['DESKTOP'],
      purposeConfirmed: true,
      ...overrides,
    };
  }

  async function enableProactive(chatbotId: string): Promise<void> {
    const res = await admin('PUT', `/chatbots/${chatbotId}/proactive/settings`, { enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300 });
    expect(res.status).toBe(200);
  }

  // ── AC-PA1-2 — 바이트 동일 골든 ─────────────────────────────────────────────
  it('AC-PA1-2: 스위치 켜짐 + 켜진 규칙 2개라도 쿼리 없이 조회하면 기존 8키 응답과 바이트 동일하다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    for (let i = 0; i < 2; i += 1) {
      const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
      expect(created.status).toBe(201);
      await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);
    }

    const plain = await publicReq<Record<string, unknown>>('GET', `/public/chatbots/${slug}/config`);
    expect(plain.status).toBe(200);
    expect('proactive' in plain.body).toBe(false);

    const withProactive = await publicReq<Record<string, unknown>>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(withProactive.status).toBe(200);
    expect('proactive' in withProactive.body).toBe(true);

    // 바이트 동일 보장(§5.1) — proactive 키를 뺀 나머지가 쿼리 없는 응답과 정확히 같다(키 순서 포함).
    const { proactive: _drop, ...withoutProactive } = withProactive.body;
    expect(JSON.stringify(plain.body)).toBe(JSON.stringify(withoutProactive));
  });

  it('AC-PA1-1 회귀: 스위치 꺼짐(기본) 챗봇의 ?proactive=1 조회는 rules:[]다', async () => {
    const { slug } = await createChatbot();
    const res = await publicReq<{ proactive?: { rules: unknown[] } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(res.status).toBe(200);
    expect(res.body.proactive?.rules).toEqual([]);
  });

  // ── 관리 API CRUD · 권한 · 감사 ────────────────────────────────────────────
  it('AC-PA2-1: 규칙 생성은 201 + 감사 1건(원문 없음) · channel:read만 있으면 403', async () => {
    const { chatbotId } = await createChatbot();
    const forbidden = await viewer('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
    expect(forbidden.status).toBe(403);

    const created = await admin<{ id: string; enabled: boolean; position: number }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ name: '배송조회 도움' }));
    expect(created.status).toBe(201);
    expect(created.body.enabled).toBe(false);

    const auditRes = await admin<{ items: Array<{ action: string; targetType: string; summary: string | null }> }>('GET', `/audit-logs?targetType=ProactiveRule&pageSize=5`);
    const entry = auditRes.body.items.find((i) => i.action === 'CREATE');
    expect(entry).toBeDefined();
    expect(entry?.summary).toContain('광고');
    expect(entry?.summary).not.toContain('주문·배송 조회를 도와드릴까요?');
  });

  it('AC-PA2-2: purposeConfirmed 없이 저장하면 400', async () => {
    const { chatbotId } = await createChatbot();
    const { purposeConfirmed: _drop, ...rest } = pageDwellRuleBody();
    const res = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, rest);
    expect(res.status).toBe(400);
  });

  it('이름 중복은 409 DUPLICATE_NAME', async () => {
    const { chatbotId } = await createChatbot();
    const body = pageDwellRuleBody({ name: '중복이름' });
    const first = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, body);
    expect(first.status).toBe(201);
    const second = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, body);
    expect(second.status).toBe(409);
  });

  it('NODE 버튼이 없거나 꺼진 노드를 가리키면 400 INVALID_REFERENCE', async () => {
    const { chatbotId } = await createChatbot();
    const res = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ buttons: [{ label: '이동', action: 'NODE', value: randomUUID() }] }));
    expect(res.status).toBe(400);
  });

  it('AC-PA2-4: LINK 버튼 값이 http://면 400(https만 허용 — inspectRichUrl 재사용)', async () => {
    const { chatbotId } = await createChatbot();
    const res = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ buttons: [{ label: '바로가기', action: 'LINK', value: 'http://example.com' }] }));
    expect(res.status).toBe(400);
  });

  it('AC-PA2-4: 허용 도메인 목록이 있는 챗봇에서 목록 밖 https 주소는 400(허용 도메인은 201)', async () => {
    const { chatbotId } = await createChatbot();
    const policyRes = await admin('PUT', `/chatbots/${chatbotId}/rich-url-policy`, { hosts: [{ host: 'allowed.example.com', includeSubdomains: false }] });
    expect(policyRes.status).toBe(200);

    const outside = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ buttons: [{ label: '바로가기', action: 'LINK', value: 'https://not-allowed.example.com/path' }] }));
    expect(outside.status).toBe(400);

    const inside = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ buttons: [{ label: '바로가기', action: 'LINK', value: 'https://allowed.example.com/path' }] }));
    expect(inside.status).toBe(201);
  });

  it('AC-PA2-5: 켜진 규칙 10개에서 11번째를 켜면 400이고 상태가 바뀌지 않는다', async () => {
    const { chatbotId } = await createChatbot();
    const ruleIds: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
      ruleIds.push(created.body.id);
    }
    for (let i = 0; i < 10; i += 1) {
      const res = await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${ruleIds[i]}/enable`);
      expect(res.status).toBe(200);
    }
    const overLimit = await admin<{ id: string; enabled: boolean }>('POST', `/chatbots/${chatbotId}/proactive/rules/${ruleIds[10]}/enable`);
    expect(overLimit.status).toBe(400);

    const detail = await admin<{ enabled: boolean }>('GET', `/chatbots/${chatbotId}/proactive/rules/${ruleIds[10]}`);
    expect(detail.body.enabled).toBe(false);
  });

  it('코드 리뷰 High #1: 19개 상태에서 동시 5개 생성 요청을 보내도 20개로 막힌다(트랜잭션 안 count)', async () => {
    const { chatbotId } = await createChatbot();
    for (let i = 0; i < 19; i += 1) {
      const res = await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
      expect(res.status).toBe(201);
    }

    const results = await Promise.all(
      Array.from({ length: 5 }, () => admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody())),
    );
    const succeeded = results.filter((r) => r.status === 201);
    const limited = results.filter((r) => r.status === 400);
    expect(succeeded.length).toBe(1);
    expect(limited.length).toBe(4);

    const total = await prisma.proactiveRule.count({ where: { chatbotId } });
    expect(total).toBe(20);
  });

  it('순서 이동(UP/DOWN) — 이웃과 position을 교환한다', async () => {
    const { chatbotId } = await createChatbot();
    const first = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ name: '첫번째' }));
    const second = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ name: '두번째' }));

    const moved = await admin<Array<{ id: string; name: string }>>('POST', `/chatbots/${chatbotId}/proactive/rules/${second.body.id}/move`, { direction: 'UP' });
    expect(moved.status).toBe(200);
    expect(moved.body.map((r) => r.name)).toEqual(['두번째', '첫번째']);
    void first;
  });

  it('규칙 삭제 후에도 집계는 이름 스냅샷과 함께 남는다(FR-PA6-5)', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ name: '삭제될규칙' }));
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const sessionId = randomUUID();
    const shown = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId, ruleId: created.body.id, kind: 'SHOWN' });
    expect(shown.status).toBe(204);

    const del = await admin('DELETE', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}`);
    expect(del.status).toBe(204);

    const stats = await admin<{ totals: Array<{ ruleId: string; name: string; deleted: boolean; shown: number }> }>('GET', `/chatbots/${chatbotId}/proactive/stats`);
    const row = stats.body.totals.find((t) => t.ruleId === created.body.id);
    expect(row).toEqual(expect.objectContaining({ name: '삭제될규칙', deleted: true, shown: 1 }));
  });

  // ── 공개 조회 필터 — 노드 유효성 · 금지어 · 기간 ────────────────────────────
  it('AC-PA9-1: NODE 버튼이 가리키는 노드를 끄면 그 규칙 전체가 공개 조회에서 빠진다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const nodeId = await createEnabledNode(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ buttons: [{ label: '이동', action: 'NODE', value: nodeId }] }));
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const before = await publicReq<{ proactive: { rules: Array<{ id: string }> } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(before.body.proactive.rules.map((r) => r.id)).toContain(created.body.id);

    await admin('PATCH', `/chatbots/${chatbotId}/dialog-nodes/${nodeId}`, { enabled: false });

    const after = await publicReq<{ proactive: { rules: Array<{ id: string }> } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(after.body.proactive.rules.map((r) => r.id)).not.toContain(created.body.id);

    const listRes = await admin<{ rules: Array<{ id: string; issues: string[] }> }>('GET', `/chatbots/${chatbotId}/proactive`);
    const view = listRes.body.rules.find((r) => r.id === created.body.id);
    expect(view?.issues).toContain('TARGET_UNAVAILABLE');
  });

  it('금지어가 포함된 문구를 가진 규칙은 공개 조회에서 제외된다(EX-PA-12)', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const bannedWord = `금칙어${randomUUID().slice(0, 6)}`;
    await admin('POST', '/banned-words', { word: bannedWord, matchType: 'CONTAINS', policy: 'WARN', enabled: true });

    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ text: `이 문구에는 ${bannedWord}가 있습니다` }));
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const res = await publicReq<{ proactive: { rules: Array<{ id: string }> } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(res.body.proactive.rules.map((r) => r.id)).not.toContain(created.body.id);
  });

  it('게시 기간이 지난 규칙은 공개 조회에 없다(AC-PA4-6)', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody({ endsAt: past }));
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const res = await publicReq<{ proactive: { rules: Array<{ id: string }> } }>('GET', `/public/chatbots/${slug}/config?proactive=1`);
    expect(res.body.proactive.rules.map((r) => r.id)).not.toContain(created.body.id);
  });

  // ── 수집 사건 ────────────────────────────────────────────────────────────
  it('AC-PA5-3/4: 결합 검증 불일치·중복은 조용히 무시하고 정상 5회는 +1만 증가한다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const otherChatbot = await createChatbot();

    // 다른 챗봇 슬러그로 이 규칙 id를 보내면 무시(카운터 불변).
    const wrongSlug = await publicReq('POST', `/public/chatbots/${otherChatbot.slug}/proactive-events`, { sessionId: randomUUID(), ruleId: created.body.id, kind: 'SHOWN' });
    expect(wrongSlug.status).toBe(204);
    // 없는 규칙 id.
    const missingRule = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId: randomUUID(), ruleId: randomUUID(), kind: 'SHOWN' });
    expect(missingRule.status).toBe(204);
    // 모르는 필드(url) → strict 위반 400.
    const badBody = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId: randomUUID(), ruleId: created.body.id, kind: 'SHOWN', url: '/x' });
    expect(badBody.status).toBe(400);

    // 같은 (session, rule, SHOWN)을 5번 보내면 카운터는 1만 증가한다.
    const sessionId = randomUUID();
    for (let i = 0; i < 5; i += 1) {
      const res = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId, ruleId: created.body.id, kind: 'SHOWN' });
      expect(res.status).toBe(204);
    }

    const stats = await admin<{ totals: Array<{ ruleId: string; shown: number }> }>('GET', `/chatbots/${chatbotId}/proactive/stats`);
    const row = stats.body.totals.find((t) => t.ruleId === created.body.id);
    expect(row?.shown).toBe(1);
  });

  it('AC-PA1-7: 표시·닫기·끄기 수집 후에도 대화 로그(ConversationLog)는 0행이다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const sessionId = randomUUID();
    for (const kind of ['SHOWN', 'DISMISSED', 'OPTED_OUT']) {
      const res = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId, ruleId: created.body.id, kind });
      expect(res.status).toBe(204);
    }

    const logCount = await prisma.conversationLog.count({ where: { sessionId } });
    expect(logCount).toBe(0);
  });

  // ── 레이트리밋 분리(FR-PA5-5) ───────────────────────────────────────────
  it('AC-PA5-5: 수집 세션 버킷 초과 뒤에도 같은 IP의 대화 전송은 429가 아니다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);

    const sessionId = randomUUID();
    let sawRateLimited = false;
    for (let i = 0; i < 6; i += 1) {
      const res = await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId, ruleId: created.body.id, kind: 'CLICKED' });
      if (res.status === 429) sawRateLimited = true;
    }
    expect(sawRateLimited).toBe(true);

    const messageRes = await publicReq<{ messageId: string }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
    expect(messageRes.status).toBe(200);
  });

  // ── 거버넌스 · 데이터 지도 ───────────────────────────────────────────────
  it('AC-PA7-2: 규칙이 있으면 데이터 지도에 proactive 절이 나타난다', async () => {
    const { chatbotId } = await createChatbot();
    await enableProactive(chatbotId);
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());

    const map = await admin<{ proactive?: { rules: number; counters: string; browserStorage: string } }>('GET', '/governance/map');
    expect(map.body.proactive).toBeDefined();
    expect(map.body.proactive?.rules).toBeGreaterThan(0);
    expect(map.body.proactive?.counters).toBe('RULE_DAILY_COUNTS_ONLY');
    expect(map.body.proactive?.browserStorage).toBe('SESSION_STORAGE');
  });

  // ── 영구삭제 동반 삭제(X-7) ─────────────────────────────────────────────
  it('챗봇 영구삭제 시 선제 안내 설정·규칙·집계가 함께 삭제된다', async () => {
    const { chatbotId, slug } = await createChatbot();
    await enableProactive(chatbotId);
    const created = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/proactive/rules`, pageDwellRuleBody());
    await admin('POST', `/chatbots/${chatbotId}/proactive/rules/${created.body.id}/enable`);
    await publicReq('POST', `/public/chatbots/${slug}/proactive-events`, { sessionId: randomUUID(), ruleId: created.body.id, kind: 'SHOWN' });

    // 영구삭제 사전검사는 채널 존재도 막는다(§18) — 이 시험의 관심사가 아니므로 먼저 지운다.
    await admin('DELETE', `/chatbots/${chatbotId}/channels/WEB`);
    await admin('DELETE', `/chatbots/${chatbotId}`); // 보관(ARCHIVED) 전환
    const del = await admin('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: '선제안내테스트봇' });
    expect(del.status).toBe(204);

    expect(await prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId } })).toBeNull();
    expect(await prisma.proactiveRule.count({ where: { chatbotId } })).toBe(0);
    expect(await prisma.proactiveDailyStat.count({ where: { chatbotId } })).toBe(0);
  });
});
