import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { toKstDayBucket } from '@chat-bot/shared-types';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import type { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';

/**
 * 데이터 거버넌스(No.45) — 열람(`VIEW`)·내보내기(`EXPORT`) 감사 통합 시험(★ AC-DG7-1/7-2/7-3,
 * `data-governance-설계.md` §11). test-automation 보강(2026-09-26).
 * - `VIEW`는 닫힌 목록 8핸들러(V-1~V-8) **전부**를 같은 열람자로 두 번씩 호출해 (열람자·리소스·
 *   KST 일)당 1건으로 중복 억제되는지 확인한다.
 * - `EXPORT`는 감사로그 CSV·설문 결과 CSV 2곳을 호출해 감사 1건씩 남고, 요약에 검색어 원문·본문이
 *   없는지 확인한다(TC 결과 CSV는 실행 기록을 만드는 비용이 커 이번 회차에서 제외 — 정적 검사
 *   `governance-sealing.spec.ts`(G-15)가 `recordExport()` 호출 지점 3곳을 이미 고정한다).
 * - `AccessViewInterceptor`는 `void this.auditLog.recordView(...)`로 **fire-and-forget** 기록한다
 *   (응답이 먼저 온다) — CLAUDE.md 규약대로 각 호출 뒤 실제 행이 생길 때까지 폴링한 다음에야 다음
 *   호출을 보낸다(그렇지 않으면 두 번째 호출의 중복 판정 쿼리가 첫 번째 호출의 INSERT보다 먼저
 *   실행돼 레이스로 2건이 생길 수 있다 — 실제로 관측했다).
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('데이터 거버넌스(No.45) 통합 시험 — 열람(VIEW)·내보내기(EXPORT) 감사(AC-DG7-1/7-2/7-3)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;
  let adminUserId: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-view-export-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.HANDOFF_SWEEPER_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
    process.env.EMBEDDING_BASE_URL = '';
    process.env.RAG_BASE_URL = '';

    process.env.DATA_GOVERNANCE_MODE = 'ON';
    process.env.DATA_ENCRYPTION_ENABLED = 'false';
    process.env.DATA_ENCRYPTION_KEYS = '';
    process.env.DATA_EGRESS_ALLOWED_HOSTS = '';
    process.env.DATA_RETENTION_JOB_ENABLED = 'false';
    process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';

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
    const { normalizeEmail } = await import('@chat-bot/shared-types');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: normalizeEmail('integration-test-admin@chat-bot.local') } });
    adminUserId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest<T>(method, `${baseUrl}${path}`, body, { Cookie: adminCookie });
  }

  async function countView(targetType: string, targetId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action: 'VIEW', actorId: adminUserId, targetType, targetId } });
  }

  /** recordView()는 fire-and-forget이라 응답이 먼저 온다 — CLAUDE.md 규약대로 실제 행이 생길 때까지 폴링한다. */
  async function waitForViewCountAtLeast(targetType: string, targetId: string, n: number, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await countView(targetType, targetId)) >= n) return;
      if (Date.now() > deadline) throw new Error(`VIEW 감사 대기 시간 초과: ${targetType}/${targetId}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('V-1~V-8: 같은 열람자가 같은 리소스를 하루에 여러 번 열어도 VIEW 감사는 (열람자·리소스·일)당 1건이다', async () => {
    // ── 픽스처: 상담(진행 중) · 미응답 질문 · 설문 응답(자유 텍스트) · 감사로그 1건(챗봇 그룹 생성) ──
    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-VIEW감사-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: 'VIEW 감사 챗봇', slug: `view-audit-${randomUUID().slice(0, 8)}` } });
    const now = new Date();
    const sessionRef = randomUUID().replace(/-/g, '').slice(0, 16);
    const handoff = await prisma.handoffSession.create({
      data: {
        chatbotId: chatbot.id,
        groupId: group.id,
        sessionId: `sess-${randomUUID()}`,
        sessionRef,
        channelType: 'WEB',
        status: 'CONNECTED',
        assignedUserId: adminUserId,
        assignedUserName: '관리자',
        startedById: adminUserId,
        startedByName: '관리자',
        alertLevelAtStart: 'NORMAL',
        consecutiveUnansweredAtStart: 0,
        startedAt: now,
        connectedAt: now,
        dayBucket: toKstDayBucket(now),
      },
    });
    await prisma.handoffMessage.create({
      data: { handoffSessionId: handoff.id, chatbotId: chatbot.id, seq: 1, sender: 'AGENT', text: '안녕하세요, 상담원입니다.' },
    });

    const uq = await prisma.unansweredQuestion.create({
      data: { chatbotId: chatbot.id, questionText: 'VIEW 감사 확인용 질문', questionNormalized: `view-audit-uq-${randomUUID().slice(0, 8)}`, status: 'PENDING' },
    });

    const questionKey = randomUUID();
    const survey = await prisma.survey.create({
      data: {
        chatbotId: chatbot.id,
        name: `VIEW감사 설문 ${randomUUID().slice(0, 6)}`,
        nameNormalized: `view-audit-survey-${randomUUID().slice(0, 8)}`,
        status: 'OPEN',
        questions: JSON.stringify([{ key: questionKey, type: 'TEXT', prompt: '의견', required: true, maxLength: 200 }]),
      },
    });
    const surveyResponse = await prisma.surveyResponse.create({
      data: {
        chatbotId: chatbot.id,
        surveyId: survey.id,
        groupId: group.id,
        sessionId: `sess-survey-${randomUUID()}`,
        channelType: 'WEB',
        structureVersion: 1,
        startedAt: now,
        dayBucket: toKstDayBucket(now),
        status: 'COMPLETED',
        started: true,
        lastQuestionIndex: 0,
        lastInteractedAt: now,
        completedAt: now,
      },
    });
    await prisma.surveyAnswer.create({
      data: {
        responseId: surveyResponse.id,
        surveyId: survey.id,
        questionKey,
        questionIndex: 0,
        kind: 'ANSWERED',
        isHead: true,
        choiceKey: '',
        textValue: 'VIEW 감사 확인용 자유 응답',
        dayBucket: toKstDayBucket(now),
        channelType: 'WEB',
        answeredAt: now,
      },
    });

    // 감사로그 대상 행 1개 확보(V-7/V-8) — 아무 관리 API 호출이든 감사를 남긴다.
    const seedAuditRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `감사대상-${randomUUID().slice(0, 6)}` });
    expect(seedAuditRes.status).toBe(201);
    const someAuditLog = await prisma.auditLog.findFirst({ where: { targetType: 'ChatbotGroup', targetId: seedAuditRes.body.id } });
    expect(someAuditLog).not.toBeNull();

    const today = toKstDayBucket(now);
    const handlers: Array<{ label: string; targetType: string; targetId: string; call: () => Promise<ApiResponse> }> = [
      { label: 'V-1 진행 중 상담 목록', targetType: 'ConversationLog', targetId: '*', call: () => admin('GET', `/chatbots/${chatbot.id}/live-sessions`) },
      {
        label: 'V-2 대화 보기(transcript)',
        targetType: 'ConversationLog',
        targetId: sessionRef,
        call: () => admin('GET', `/chatbots/${chatbot.id}/live-sessions/${sessionRef}/transcript`),
      },
      { label: 'V-3 상담 상세', targetType: 'HandoffSession', targetId: handoff.id, call: () => admin('GET', `/chatbots/${chatbot.id}/handoffs/${handoff.id}`) },
      {
        label: 'V-4 설문 응답 목록',
        targetType: 'Survey',
        targetId: survey.id,
        call: () => admin('GET', `/chatbots/${chatbot.id}/surveys/${survey.id}/responses?from=${today}&to=${today}`),
      },
      {
        label: 'V-5 설문 자유 텍스트',
        targetType: 'Survey',
        targetId: survey.id, // V-4와 같은 (열람자·리소스·일) 키 — 설계 §11.3 "하루 1건" 공유
        call: () => admin('GET', `/chatbots/${chatbot.id}/surveys/${survey.id}/text-answers?questionKey=${questionKey}&from=${today}&to=${today}`),
      },
      { label: 'V-6 미응답 질문 상세', targetType: 'UnansweredQuestion', targetId: uq.id, call: () => admin('GET', `/chatbots/${chatbot.id}/unanswered-questions/${uq.id}`) },
      { label: 'V-7 감사로그 목록', targetType: 'AuditLog', targetId: '*', call: () => admin('GET', '/audit-logs') },
      { label: 'V-8 감사로그 상세', targetType: 'AuditLog', targetId: someAuditLog!.id, call: () => admin('GET', `/audit-logs/${someAuditLog!.id}`) },
    ];

    for (const h of handlers) {
      const before = await countView(h.targetType, h.targetId);
      const r1 = await h.call();
      expect(r1.status).toBe(200);
      // 첫 호출의 fire-and-forget 기록이 실제로 끝날 때까지 기다린 뒤에야 두 번째 호출을 보낸다
      // (그렇지 않으면 두 호출의 dedupe 조회가 서로 앞서 레이스로 중복 삽입될 수 있다).
      await waitForViewCountAtLeast(h.targetType, h.targetId, Math.max(1, before));

      const r2 = await h.call();
      expect(r2.status).toBe(200);
      await new Promise((r) => setTimeout(r, 150)); // 두 번째 호출이 "기록하지 않는다"는 음성 확인 — 짧게 대기 후 그대로여야 한다.

      const r3 = await h.call();
      expect(r3.status).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
    }

    // V-4/V-5는 같은 (열람자·targetType·targetId·chatbotId·일) 키를 공유하므로 합쳐서 최대 1건이다.
    const countSurvey = await countView('Survey', survey.id);
    expect(countSurvey).toBe(1);

    for (const h of handlers) {
      if (h.targetType === 'Survey') continue; // 위에서 합산 확인함.
      const count = await countView(h.targetType, h.targetId);
      expect(count).toBe(1);
    }
  }, 30_000);

  it('AC-DG7-1: 감사로그 CSV·설문 결과 CSV 내보내기는 각각 EXPORT 감사 1건을 남기고, 요약에 검색어 원문·본문이 없다', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'EXPORT' } });

    const auditExportRes = await jsonRequest('GET', `${baseUrl}/audit-logs/export`, undefined, { Cookie: adminCookie });
    expect(auditExportRes.status).toBe(200);

    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-EXPORT감사-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: 'EXPORT 감사 챗봇', slug: `export-audit-${randomUUID().slice(0, 8)}` } });
    const survey = await prisma.survey.create({
      data: {
        chatbotId: chatbot.id,
        name: `EXPORT감사 설문 ${randomUUID().slice(0, 6)}`,
        nameNormalized: `export-audit-survey-${randomUUID().slice(0, 8)}`,
        status: 'OPEN',
        questions: '[]',
      },
    });
    const today = toKstDayBucket(new Date());
    const surveyExportRes = await jsonRequest(
      'GET',
      `${baseUrl}/chatbots/${chatbot.id}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${today}&to=${today}`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(surveyExportRes.status).toBe(200);

    // EXPORT는 응답 생성 후·전송 전에 기록한다고 설계에 적혀 있으나(§11.2), 실제로 응답이 온 뒤에는
    // 기록이 끝났다고 보고 즉시 확인한다 — 재시도 여유만 짧게 둔다(fire-and-forget이 아닌 동기 기록).
    for (let i = 0; i < 20; i += 1) {
      const c = await prisma.auditLog.count({ where: { action: 'EXPORT' } });
      if (c - before >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const after = await prisma.auditLog.count({ where: { action: 'EXPORT' } });
    expect(after - before).toBe(2);

    const exportRows = await prisma.auditLog.findMany({ where: { action: 'EXPORT' }, orderBy: { createdAt: 'desc' }, take: 2 });
    for (const row of exportRows) {
      // 요약·afterValue에 원문·검색어·sessionId류 문자열이 없어야 한다(개수·날짜·열거값만).
      expect(row.summary).not.toMatch(/sess-|sessionId/i);
      const detail = row.afterValue ? JSON.parse(row.afterValue) : {};
      expect(JSON.stringify(detail)).not.toMatch(/sess-/i);
    }
  }, 30_000);
});
