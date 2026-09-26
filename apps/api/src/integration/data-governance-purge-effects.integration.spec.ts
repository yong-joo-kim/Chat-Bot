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
 * 데이터 거버넌스(No.45) — 파기 효과 통합 시험(★ AC-DG5-1/2 · FR-DG6-6 · P-3 · §9.6). test-automation
 * 보강(2026-09-26). 기존 `data-governance.integration.spec.ts`는 `ConversationLog` 1건의 소거·행
 * 불변만 확인했다 — 이 파일은 요청받은 확인 항목 (c)를 채운다.
 * - 대화 로그 파기 전후 **통계(대시보드·기간 통계·질문 순위·통합 통계) 수치가 완전히 같다**.
 * - 미응답 큐(`UnansweredQuestion`) 종결 항목 소거 후 `#PURGED#` 센티넬이 어떤 API 응답에도
 *   노출되지 않는다(목록·상세).
 * - 설문 자유 텍스트 소거 후 응답 목록 건수는 불변이고, 자유 텍스트 목록/상세는 원문 대신
 *   "보존기간 경과로 파기됨"을 보여준다.
 * - 보존기간 하한 우회 불가(`RETENTION_OUT_OF_RANGE`) · 단축은 유예(기본 7일) 후에만 적용된다.
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

describe('데이터 거버넌스(No.45) 통합 시험 — 파기 효과(통계 불변 · #PURGED# 비노출 · 하한/유예)', () => {
  let app: NestExpressApplication | undefined;
  let tmpDir: string;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminCookie: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'data-governance-purge-effects-test-'));
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
    process.env.RETENTION_MIN_DAYS_CONVERSATION = '7'; // AC-DG4-2/§8 하한 시험용(기본과 다른 값을 명시)
    process.env.RETENTION_MIN_DAYS_AUDIT = '365';
    process.env.DATA_RETENTION_WINDOW = '00:00-00:00'; // 항상 창 안 — tick()이 즉시 동작

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
    (globalThis as Record<string, unknown>).__dgPurgeModuleRef = moduleRef;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  }, 30_000);

  async function seedChatbot(): Promise<{ chatbotId: string; groupId: string }> {
    const group = await prisma.chatbotGroup.create({ data: { name: `그룹-${randomUUID().slice(0, 8)}` } });
    const chatbot = await prisma.chatbot.create({ data: { groupId: group.id, name: '파기효과 챗봇', slug: `purge-fx-${randomUUID().slice(0, 8)}` } });
    return { chatbotId: chatbot.id, groupId: group.id };
  }

  it('AC-DG5-1/2: 대화 로그 파기 전후 대시보드·기간 통계·질문 순위 수치가 완전히 같고, 순위에 빈 문자열이 나타나지 않는다', async () => {
    const { chatbotId } = await seedChatbot();
    const oldDate = new Date(Date.now() - 40 * 86_400_000); // 40일 전 — 7일 하한보다 훨씬 이전
    const from = new Date(oldDate.getTime() - 86_400_000);
    const to = new Date();

    // 파기 대상 3행(같은 질문 반복 — 순위 1위였던 문구) + 파기 대상 아닌 최근 1행(대조군).
    for (let i = 0; i < 3; i += 1) {
      await prisma.conversationLog.create({
        data: {
          chatbotId,
          channelType: 'WEB',
          sessionId: `sess-old-${i}`,
          userMessage: '파기될 질문입니다',
          botResponse: '파기될 답변입니다',
          isAnswered: true,
          dayBucket: toKstDayBucket(oldDate),
          hourBucket: 10,
          createdAt: oldDate,
        },
      });
    }
    await prisma.conversationLog.create({
      data: {
        chatbotId,
        channelType: 'WEB',
        sessionId: 'sess-recent',
        userMessage: '최근 질문입니다',
        botResponse: '최근 답변입니다',
        isAnswered: true,
        dayBucket: toKstDayBucket(to),
        hourBucket: 11,
        createdAt: to,
      },
    });

    const q = (url: string): Promise<ApiResponse> => jsonRequest('GET', `${baseUrl}${url}`, undefined, { Cookie: adminCookie });
    const dateRange = `from=${from.toISOString()}&to=${to.toISOString()}`;

    const dashboardBefore = await q(`/stats/dashboard?chatbotId=${chatbotId}&${dateRange}`);
    const summaryBefore = await q(`/stats/summary?chatbotId=${chatbotId}&${dateRange}`);
    const questionsBefore = await q(`/stats/questions?chatbotId=${chatbotId}&${dateRange}`);
    const distributionBefore = await q(`/stats/distribution?chatbotId=${chatbotId}&${dateRange}`);
    expect(dashboardBefore.status).toBe(200);
    expect(summaryBefore.status).toBe(200);
    expect(questionsBefore.status).toBe(200);
    expect(distributionBefore.status).toBe(200);
    // 파기 전에는 "파기될 질문입니다"가 순위 최상단(3건)이어야 한다 — 파기 후 비교의 전제 조건.
    expect(JSON.stringify(questionsBefore.body)).toContain('파기될 질문입니다');

    // 전역 보존 정책: 대화 원문 10일(하한 7일 이상) — 40일 전 행은 파기 대상, 방금 만든 행은 아니다.
    await prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ CONVERSATION_TEXT: 10 }), pending: '{}' },
      update: { days: JSON.stringify({ CONVERSATION_TEXT: 10 }), pending: '{}' },
    });

    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__dgPurgeModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);
    await retentionJob.tick();

    const purgedRows = await prisma.conversationLog.findMany({ where: { chatbotId, sessionId: { startsWith: 'sess-old-' } } });
    expect(purgedRows).toHaveLength(3);
    for (const row of purgedRows) {
      expect(row.userMessage).toBe('');
      expect(row.botResponse).toBe('');
      expect(row.textPurgedAt).not.toBeNull();
      expect(row.isAnswered).toBe(true); // 수치 컬럼 불변
      expect(row.dayBucket).toBe(toKstDayBucket(oldDate)); // 버킷 불변
    }

    const dashboardAfter = await q(`/stats/dashboard?chatbotId=${chatbotId}&${dateRange}`);
    const summaryAfter = await q(`/stats/summary?chatbotId=${chatbotId}&${dateRange}`);
    const distributionAfter = await q(`/stats/distribution?chatbotId=${chatbotId}&${dateRange}`);
    expect(summaryAfter.body).toEqual(summaryBefore.body); // 턴 수·세션 수·응답률 등 수치 바이트 동일
    expect(distributionAfter.body).toEqual(distributionBefore.body);
    // 대시보드는 topQuestions(질문 순위)를 포함하므로 그 부분만 제외하고 나머지는 완전히 같다.
    const stripTopQuestions = (b: unknown) => {
      const clone = JSON.parse(JSON.stringify(b));
      delete (clone as Record<string, unknown>).topQuestions;
      return clone;
    };
    expect(stripTopQuestions(dashboardAfter.body)).toEqual(stripTopQuestions(dashboardBefore.body));

    const questionsAfter = await q(`/stats/questions?chatbotId=${chatbotId}&${dateRange}`);
    // 파기된 질문은 순위에서 빠지고, 빈 문자열이 순위에 나타나지 않는다(FR-DG6-6).
    expect(JSON.stringify(questionsAfter.body)).not.toContain('파기될 질문입니다');
    const topQuestions = (questionsAfter.body as { topQuestions: Array<{ question: string }> }).topQuestions;
    expect(topQuestions.some((q2) => q2.question === '')).toBe(false);
    const dashTopQuestions = (dashboardAfter.body as { topQuestions: Array<{ question: string }> }).topQuestions;
    expect(dashTopQuestions.some((q2) => q2.question === '')).toBe(false);
    // 대조군(최근 질문)은 여전히 순위에 남아 있다 — 수치 손실이 아니라 파기 대상만 빠졌다는 확인.
    expect(JSON.stringify(questionsAfter.body)).toContain('최근 질문입니다');
  }, 30_000);

  it('AC-DG5-1: 종결된 미응답 큐 항목을 파기해도 #PURGED# 센티넬이 목록·상세 API 어디에도 노출되지 않는다', async () => {
    const { chatbotId } = await seedChatbot();
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    const uq = await prisma.unansweredQuestion.create({
      data: {
        chatbotId,
        questionText: '파기될 미응답 질문',
        questionNormalized: `파기될미응답질문-${randomUUID().slice(0, 8)}`,
        variants: JSON.stringify(['파기될 미응답 질문']),
        status: 'RESOLVED',
        resolvedAt: oldDate,
        lastOccurredAt: oldDate,
        createdAt: oldDate,
      },
    });

    await prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ UNANSWERED_CLOSED: 10 }), pending: '{}' },
      update: { days: JSON.stringify({ UNANSWERED_CLOSED: 10 }), pending: '{}' },
    });

    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__dgPurgeModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);
    await prisma.governanceJobState.updateMany({ where: { jobName: 'RETENTION' }, data: { lastCompletedDay: null } }); // 같은 KST 날짜에 이미 완료된 tick()이 있으면 조용히 반환하므로(§9.1) 매 시험마다 재설정한다.
    await retentionJob.tick();

    const purgedRow = await prisma.unansweredQuestion.findUniqueOrThrow({ where: { id: uq.id } });
    expect(purgedRow.questionText).toBe('');
    expect(purgedRow.variants).toBe('[]');
    expect(purgedRow.questionNormalized).toBe(`#PURGED#${uq.id}`); // DB 컬럼 자체에는 센티넬이 있다 — 이것이 API로 새는지가 관건.
    expect(purgedRow.textPurgedAt).not.toBeNull();

    const list = await jsonRequest<{ items: Array<{ id: string; questionText: string; purged?: true }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions?status=RESOLVED`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('#PURGED#');
    const item = list.body.items.find((i) => i.id === uq.id);
    expect(item).toBeDefined();
    expect(item!.questionText).toBe('');
    expect(item!.purged).toBe(true);

    const detail = await jsonRequest('GET', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${uq.id}`, undefined, { Cookie: adminCookie });
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain('#PURGED#');
  }, 30_000);

  it('AC-DG5-2: 설문 자유 텍스트를 파기해도 응답 목록 건수는 불변이고, 자유 텍스트 목록은 원문 대신 파기 문구를 보여준다', async () => {
    const { chatbotId, groupId } = await seedChatbot();
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    const questionKey = randomUUID();

    const survey = await prisma.survey.create({
      data: {
        chatbotId,
        name: `파기효과 설문 ${randomUUID().slice(0, 6)}`,
        nameNormalized: `purge-fx-survey-${randomUUID().slice(0, 8)}`,
        status: 'OPEN',
        questions: JSON.stringify([{ key: questionKey, type: 'TEXT', prompt: '의견', required: true, maxLength: 200 }]),
      },
    });
    const response = await prisma.surveyResponse.create({
      data: {
        chatbotId,
        surveyId: survey.id,
        groupId,
        sessionId: `sess-survey-${randomUUID()}`,
        channelType: 'WEB',
        structureVersion: 1,
        startedAt: oldDate,
        dayBucket: toKstDayBucket(oldDate),
        status: 'COMPLETED',
        started: true,
        lastQuestionIndex: 0,
        lastInteractedAt: oldDate,
        completedAt: oldDate,
      },
    });
    await prisma.surveyAnswer.create({
      data: {
        responseId: response.id,
        surveyId: survey.id,
        questionKey,
        questionIndex: 0,
        kind: 'ANSWERED',
        isHead: true,
        choiceKey: '',
        textValue: '파기될 자유 응답 텍스트',
        dayBucket: toKstDayBucket(oldDate),
        channelType: 'WEB',
        answeredAt: oldDate,
      },
    });

    const from = toKstDayBucket(oldDate);
    const to = toKstDayBucket(new Date());
    const responsesBefore = await jsonRequest<{ total: number }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/surveys/${survey.id}/responses?from=${from}&to=${to}`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(responsesBefore.status).toBe(200);
    expect(responsesBefore.body.total).toBe(1);

    await prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: { scopeKey: 'GLOBAL', days: JSON.stringify({ SURVEY_FREE_TEXT: 10 }), pending: '{}' },
      update: { days: JSON.stringify({ SURVEY_FREE_TEXT: 10 }), pending: '{}' },
    });

    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__dgPurgeModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);
    await prisma.governanceJobState.updateMany({ where: { jobName: 'RETENTION' }, data: { lastCompletedDay: null } }); // 같은 KST 날짜에 이미 완료된 tick()이 있으면 조용히 반환하므로(§9.1) 매 시험마다 재설정한다.
    await retentionJob.tick();

    const responsesAfter = await jsonRequest<{ total: number }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/surveys/${survey.id}/responses?from=${from}&to=${to}`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(responsesAfter.body.total).toBe(1); // 응답 건수(카운트)는 텍스트 소거와 무관하게 불변

    const textAnswers = await jsonRequest<{ items: Array<{ text: string; purged?: true }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/surveys/${survey.id}/text-answers?questionKey=${questionKey}&from=${from}&to=${to}`,
      undefined,
      { Cookie: adminCookie },
    );
    expect(textAnswers.status).toBe(200);
    expect(textAnswers.body.items.length).toBeGreaterThan(0);
    expect(textAnswers.body.items[0].text).toBe('보존기간 경과로 파기됨');
    expect(textAnswers.body.items[0].purged).toBe(true);
    expect(JSON.stringify(textAnswers.body)).not.toContain('파기될 자유 응답 텍스트');
  }, 30_000);

  it('AC-DG4-2/AC-DG4-1: 서버 하한 미만 저장은 400 RETENTION_OUT_OF_RANGE, 단축은 확인 문자열 + 유예 뒤에만 적용된다', async () => {
    // 하한(7일) 미만 요청 — 즉시 거부, 확인 문자열이 없어도 이 오류가 먼저 난다.
    const belowMin = await jsonRequest<{ code: string }>(
      'PUT',
      `${baseUrl}/governance/retention`,
      { days: { CONVERSATION_TEXT: 3, UNANSWERED_CLOSED: null, SURVEY_FREE_TEXT: null, HANDOFF_TEXT: null, CALL_LOGS: null, AUDIT_LOGS: null } },
      { Cookie: adminCookie },
    );
    expect(belowMin.status).toBe(400);
    expect(belowMin.body.code).toBe('RETENTION_OUT_OF_RANGE');

    // 하한 이상(30일)이지만 무기한 → 유한값으로의 "단축" — 확인 문자열 없이는 거부된다.
    const noConfirm = await jsonRequest<{ code: string }>(
      'PUT',
      `${baseUrl}/governance/retention`,
      { days: { CONVERSATION_TEXT: 30, UNANSWERED_CLOSED: null, SURVEY_FREE_TEXT: null, HANDOFF_TEXT: null, CALL_LOGS: null, AUDIT_LOGS: null } },
      { Cookie: adminCookie },
    );
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.code).toBe('CONFIRM_NAME_MISMATCH');

    // 확인 문자열을 정확히 입력하면 저장은 성공하지만, 새 기준은 "적용 예정"(유예 뒤)일 뿐 즉시 적용되지 않는다.
    // ⚠ 발견: 설계서 §15.1 3번은 응답이 'RetentionPolicyResponse + appliedNow[] + pendingKinds[]'라고
    // 명시하지만, 실제 컨트롤러(governance.controller.ts updateRetention)는 RetentionPolicyResponse만
    // 반환한다(appliedNow/pendingKinds 최상위 필드 없음) — 같은 정보는 kinds[].pending으로 파생 가능하므로
    // 기능 결함은 아니나 계약 불일치다(하단 보고 참고).
    const withConfirm = await jsonRequest<{ kinds: Array<{ kind: string; pending?: { days: number | null; effectiveAt: string } }> }>(
      'PUT',
      `${baseUrl}/governance/retention`,
      {
        days: { CONVERSATION_TEXT: 30, UNANSWERED_CLOSED: null, SURVEY_FREE_TEXT: null, HANDOFF_TEXT: null, CALL_LOGS: null, AUDIT_LOGS: null },
        confirmText: '보존기간 단축',
      },
      { Cookie: adminCookie },
    );
    expect(withConfirm.status).toBe(200);
    const updatedKindView = withConfirm.body.kinds.find((k) => k.kind === 'CONVERSATION_TEXT');
    expect(updatedKindView?.pending).toBeDefined();

    const getResp = await jsonRequest<{ kinds: Array<{ kind: string; pending?: { days: number | null; effectiveAt: string } }> }>(
      'GET',
      `${baseUrl}/governance/retention`,
      undefined,
      { Cookie: adminCookie },
    );
    const kindView = getResp.body.kinds.find((k) => k.kind === 'CONVERSATION_TEXT');
    expect(kindView?.pending).toBeDefined();
    const effectiveAt = new Date(kindView!.pending!.effectiveAt).getTime();
    const now = Date.now();
    // 기본 유예 7일 — 대략 6.9~7.1일 범위(테스트 실행 지연 여유).
    expect(effectiveAt - now).toBeGreaterThan(6.5 * 86_400_000);
    expect(effectiveAt - now).toBeLessThan(7.5 * 86_400_000);

    // 유예 중에는 파기 잡이 돌아도 아직 새 정책(30일)이 적용되지 않는다 — 40일 전 대화 로그가 있어도
    // 전역 정책에 UNANSWERED_CLOSED 등 다른 종류만 있었을 뿐 CONVERSATION_TEXT는 여전히 "무기한"이다.
    const { chatbotId } = await seedChatbot();
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    const log = await prisma.conversationLog.create({
      data: {
        chatbotId,
        channelType: 'WEB',
        sessionId: 'sess-grace',
        userMessage: '유예 중 질문',
        botResponse: '유예 중 답변',
        isAnswered: true,
        dayBucket: toKstDayBucket(oldDate),
        hourBucket: 9,
        createdAt: oldDate,
      },
    });
    const { RetentionJob } = await import('../governance/jobs/retention.job');
    const moduleRef = (globalThis as Record<string, unknown>).__dgPurgeModuleRef as import('@nestjs/testing').TestingModule;
    const retentionJob = moduleRef.get(RetentionJob);
    await prisma.governanceJobState.updateMany({ where: { jobName: 'RETENTION' }, data: { lastCompletedDay: null } }); // 같은 KST 날짜에 이미 완료된 tick()이 있으면 조용히 반환하므로(§9.1) 매 시험마다 재설정한다.
    await retentionJob.tick();
    const stillIntact = await prisma.conversationLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(stillIntact.textPurgedAt).toBeNull();
    expect(stillIntact.userMessage).toBe('유예 중 질문');
  }, 30_000);
});
