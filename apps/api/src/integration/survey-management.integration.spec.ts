import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { toKstDayBucket } from '@chat-bot/shared-types';

const API_ROOT = join(__dirname, '..', '..');

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: http.IncomingHttpHeaders;
}

let authCookie = '';
let editorCookie = '';
let viewerCookie = '';

function jsonRequest<T = unknown>(method: string, url: string, body?: unknown, cookieOverride?: string): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const cookie = cookieOverride !== undefined ? cookieOverride : authCookie;
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 설문관리(No.27) 통합 테스트 — `docs/02-spec/survey-management-설계.md` §18 인계 항목 중 HTTP
 * 계약·전체 대화 흐름·DB 적재를 다룬다(순수 함수 판정은 `survey-session.spec.ts`·`survey-turn.spec.ts`가 커버).
 */
describe('설문관리(No.27) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-survey-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false';
    process.env.WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'http://localhost:5174';
    process.env.PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

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
    authCookie = await loginAs(baseUrl, 'ADMIN');
    editorCookie = await loginAs(baseUrl, 'EDITOR');
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function admin<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body);
  }
  /** 공개 대화 경로 전용 — 쿠키를 아예 보내지 않는다(진짜 익명 호출). */
  function anon<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, '');
  }
  function editor<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, editorCookie);
  }
  function viewer<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, viewerCookie);
  }
  /** 관리자 경로를 쿠키 없이 호출 — 401 확인용. */
  function noAuth<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return jsonRequest(method, `${baseUrl}${path}`, body, '');
  }

  async function createChatbotWithChannel(namePrefix: string): Promise<{ chatbotId: string; slug: string }> {
    const groupRes = await admin<{ id: string }>('POST', '/chatbot-groups', { name: `${namePrefix}-그룹-${Math.random().toString(36).slice(2, 8)}` });
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `survey-${suffix}`;
    const res = await admin<{ id: string }>('POST', '/chatbots', { groupId: groupRes.body.id, name: `${namePrefix}-${suffix}`, slug });
    const chatbotId = res.body.id;
    await admin('PATCH', `/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await admin('PATCH', `/chatbots/${chatbotId}/channels/WEB`, { enabled: true, config: { allowedOrigins: [], greetingMessage: '안녕' } });
    return { chatbotId, slug };
  }

  async function createIntent(chatbotId: string, name: string, examples: string[]): Promise<string> {
    const res = await admin<{ intent: { id: string } }>('POST', `/chatbots/${chatbotId}/intents`, { name, examples });
    return res.body.intent.id;
  }

  interface CreatedSurvey {
    id: string;
  }

  async function createSurvey(chatbotId: string, overrides: Record<string, unknown> = {}): Promise<CreatedSurvey> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const res = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/surveys`, {
      name: `만족도설문-${suffix}`,
      questions: [
        { type: 'SCALE', prompt: '만족도를 알려주세요.', required: true, scale: 'STAR_5' },
        {
          type: 'MULTI_CHOICE',
          prompt: '이유를 모두 골라주세요.',
          required: true,
          minSelect: 1,
          maxSelect: 2,
          choices: [{ label: '속도' }, { label: '친절도' }, { label: '가격' }],
        },
        { type: 'TEXT', prompt: '자유 의견', required: false, maxLength: 200 },
      ],
      ...overrides,
    });
    expect(res.status).toBe(201);
    return { id: res.body.id };
  }

  async function openSurvey(chatbotId: string, surveyId: string): Promise<void> {
    const res = await admin('PATCH', `/chatbots/${chatbotId}/surveys/${surveyId}`, { status: 'OPEN' });
    expect(res.status).toBe(200);
  }

  it('설문 생성 → 201 DRAFT, 이름·문항 수가 응답에 실린다', async () => {
    const { chatbotId } = await createChatbotWithChannel('생성테스트');
    const survey = await createSurvey(chatbotId);
    const detail = await admin<{ status: string; questions: unknown[] }>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}`);
    expect(detail.body.status).toBe('DRAFT');
    expect(detail.body.questions).toHaveLength(3);
  });

  it('v1 SURVEY(자유 문자열) 노드 저장은 400 SURVEY_OUTPUT_LEGACY_FORMAT으로 거부된다', async () => {
    const { chatbotId } = await createChatbotWithChannel('v1거부');
    const intentId = await createIntent(chatbotId, '설문요청', ['설문 참여할래요']);
    const res = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '설문노드',
      intentIds: [intentId],
      outputs: [{ type: 'SURVEY', payload: { surveyId: 'legacy-free-key' } }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SURVEY_OUTPUT_LEGACY_FORMAT');
  });

  it('v2 SURVEY 노드는 저장되고, 존재하지 않는 설문을 참조하면 404 INVALID_REFERENCE다', async () => {
    const { chatbotId } = await createChatbotWithChannel('v2검증');
    const intentId = await createIntent(chatbotId, '설문요청2', ['설문 참여']);
    const bad = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '설문노드',
      intentIds: [intentId],
      outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: randomUUID() } }],
    });
    expect(bad.status).toBe(404);
    expect(bad.body.code).toBe('INVALID_REFERENCE');

    const survey = await createSurvey(chatbotId);
    await openSurvey(chatbotId, survey.id);
    const ok = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '설문노드2',
      intentIds: [intentId],
      outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
    });
    expect(ok.status).toBe(201);
  });

  it('오픈 검증 실패 — 문항 0개 설문은 OPEN 전환 시 400 VALIDATION_FAILED다', async () => {
    const { chatbotId } = await createChatbotWithChannel('오픈검증');
    const survey = await createSurvey(chatbotId, { questions: [] });
    const res = await admin<{ code: string }>('PATCH', `/chatbots/${chatbotId}/surveys/${survey.id}`, { status: 'OPEN' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('설문을 참조하는 노드가 있으면 삭제가 409 SURVEY_IN_USE로 거부된다', async () => {
    const { chatbotId } = await createChatbotWithChannel('참조삭제');
    const intentId = await createIntent(chatbotId, '설문요청3', ['설문 시작해줘']);
    const survey = await createSurvey(chatbotId);
    await openSurvey(chatbotId, survey.id);
    await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
      name: '설문노드3',
      intentIds: [intentId],
      outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
    });
    const res = await admin<{ code: string }>('DELETE', `/chatbots/${chatbotId}/surveys/${survey.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SURVEY_IN_USE');
  });

  it('복제는 DRAFT·문항 key 재발급으로 새 설문을 만든다', async () => {
    const { chatbotId } = await createChatbotWithChannel('복제');
    const survey = await createSurvey(chatbotId);
    const original = await admin<{ questions: Array<{ key: string }> }>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}`);
    const copyRes = await admin<{ id: string; status: string; questions: Array<{ key: string }> }>('POST', `/chatbots/${chatbotId}/surveys/${survey.id}/copy`, {});
    expect(copyRes.status).toBe(201);
    expect(copyRes.body.status).toBe('DRAFT');
    expect(copyRes.body.id).not.toBe(survey.id);
    const originalKeys = original.body.questions.map((q) => q.key);
    const copyKeys = copyRes.body.questions.map((q) => q.key);
    expect(copyKeys.some((k) => originalKeys.includes(k))).toBe(false);
  });

  describe('공개 대화를 통한 설문 완주 — 응답 적재·통계·CSV', () => {
    async function setupOpenSurveyFlow(prefix: string) {
      const { chatbotId, slug } = await createChatbotWithChannel(prefix);
      const intentId = await createIntent(chatbotId, `${prefix}_설문요청`, ['만족도 조사 참여할래요']);
      const survey = await createSurvey(chatbotId);
      await openSurvey(chatbotId, survey.id);
      const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: `${prefix}_설문노드`,
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const detail = await admin<{ questions: Array<{ key: string; type: string }> }>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}`);
      return { chatbotId, slug, surveyId: survey.id, nodeId: nodeRes.body.id, questions: detail.body.questions };
    }

    it('설문을 완주하면 3문항 모두 저장되고 설문 턴은 대화로그에 surveyTurn=true로 남는다(AC-SV3-1)', async () => {
      const { chatbotId, slug, surveyId } = await setupOpenSurveyFlow('완주');
      const sessionId = randomUUID();

      const t0 = await anon<{ state: unknown; outputs: unknown[] }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요' });
      expect(t0.status).toBe(200);
      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '5점', state: t0.body.state });
      const t2 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '속도,친절도', state: t1.body.state });
      const t3 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '아주 좋았어요', state: t2.body.state });

      expect((t3.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();
      expect((t3.body.state as { completedSurveyIds?: string[] }).completedSurveyIds).toContain(surveyId);

      const responses = await prisma.surveyResponse.findMany({ where: { surveyId } });
      expect(responses).toHaveLength(1);
      expect(responses[0].status).toBe('COMPLETED');
      expect(responses[0].sessionId).toBe(sessionId);
      expect(responses[0].missingRequiredCount).toBe(0);

      const answers = await prisma.surveyAnswer.findMany({ where: { responseId: responses[0].id } });
      // SCALE 1행 + MULTI_CHOICE 2행(선택 2개) + TEXT 1행 = 4행
      expect(answers).toHaveLength(4);
      const textAnswer = answers.find((a) => a.textValue !== null);
      expect(textAnswer?.textValue).toBe('아주 좋았어요');

      const chatbotIdOfSession = chatbotId;
      const logs = await prisma.conversationLog.findMany({ where: { chatbotId: chatbotIdOfSession, sessionId }, orderBy: { createdAt: 'asc' } });
      const surveyTurns = logs.filter((l) => l.surveyTurn);
      expect(surveyTurns.length).toBeGreaterThanOrEqual(3); // 응답 3턴(완료 포함)은 설문이 소비했다.
    });

    it('완료 후 재노출은 노출 시점에 isDuplicate=true로 기록된다(AC-SV3-5)', async () => {
      const { slug, surveyId } = await setupOpenSurveyFlow('중복');
      const sessionId = randomUUID();
      let state: unknown;
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요' });
      state = t0.body.state;
      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '4점', state });
      state = t1.body.state;
      const t2 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '가격', state });
      state = t2.body.state;
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '(의견 없음)', state });

      // 완료 목록(completedSurveyIds)을 지운 봉투로 다시 시작 — 서버는 여전히 DB로 중복을 판정한다.
      const freshState = { version: 1, contextSession: null };
      const restart = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요', state: freshState });
      expect(restart.status).toBe(200);

      const responses = await prisma.surveyResponse.findMany({ where: { surveyId }, orderBy: { createdAt: 'asc' } });
      expect(responses).toHaveLength(2);
      expect(responses[0].isDuplicate).toBe(false);
      expect(responses[1].isDuplicate).toBe(true);
    });

    it('통계 요약이 노출·시작·완료·참여율을 정확히 집계한다', async () => {
      const { chatbotId, slug, surveyId } = await setupOpenSurveyFlow('통계');
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요' });
      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '3점', state: t0.body.state });
      const t2 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '가격', state: t1.body.state });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '없음', state: t2.body.state });

      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const summary = await admin<{ totals: { exposed: number; started: number; completed: number; participationRate: number | null } }>(
        'GET',
        `/chatbots/${chatbotId}/surveys/${surveyId}/stats/summary?from=${today}&to=${today}`,
      );
      expect(summary.status).toBe(200);
      expect(summary.body.totals.exposed).toBe(1);
      expect(summary.body.totals.started).toBe(1);
      expect(summary.body.totals.completed).toBe(1);
      expect(summary.body.totals.participationRate).toBe(1);

      const questions = await admin<{ questions: Array<{ answered: number }> }>(
        'GET',
        `/chatbots/${chatbotId}/surveys/${surveyId}/stats/questions?from=${today}&to=${today}`,
      );
      expect(questions.status).toBe(200);
      expect(questions.body.questions[0].answered).toBe(1);
    });

    it('CSV 내보내기는 sessionId 열 없이 응답 원자료를 돌려준다', async () => {
      const { chatbotId, slug, surveyId } = await setupOpenSurveyFlow('CSV');
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '만족도 조사 참여할래요' });
      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '2점', state: t0.body.state });
      const t2 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '속도', state: t1.body.state });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '없음', state: t2.body.state });

      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const res = await admin<string>('GET', `/chatbots/${chatbotId}/surveys/${surveyId}/responses/export?kind=RESPONSES&from=${today}&to=${today}`);
      expect(res.status).toBe(200);
      expect(res.body).not.toContain(sessionId);
      expect(res.body).toContain('응답 번호');
      expect(res.body).not.toContain('sessionId');
    });
  });

  describe('2. 상태 위변조 — 봉투 조작은 서버 저장에 영향을 주지 못한다(§6.4)', () => {
    async function startSurveyTurn(prefix: string) {
      const { chatbotId, slug } = await createChatbotWithChannel(prefix);
      const intentId = await createIntent(chatbotId, `${prefix}_설문요청`, ['설문 시작해줘 위변조']);
      const survey = await createSurvey(chatbotId);
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: `${prefix}_설문노드`,
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: { surveySession?: { surveyId: string; structureVersion: number; nodeId: string | null; outputIndex: number; questionIndex: number; retryCount: number; startedAt: string; lastInteractedAt: string } } }>(
        'POST',
        `/public/chatbots/${slug}/messages`,
        { sessionId, message: '설문 시작해줘 위변조' },
      );
      expect(t0.body.state.surveySession).toBeDefined();
      return { chatbotId, slug, surveyId: survey.id, sessionId, session: t0.body.state.surveySession! };
    }

    it('다른 챗봇(다른 설문)의 surveyId로 조작된 봉투는 폐기되고, 그 설문에는 응답 행이 0건이다', async () => {
      const a = await startSurveyTurn('위변조A');
      const bOther = await createChatbotWithChannel('위변조B');
      const otherSurvey = await createSurvey(bOther.chatbotId);
      await openSurvey(bOther.chatbotId, otherSurvey.id);

      const forged = {
        version: 1,
        contextSession: null,
        surveySession: { ...a.session, surveyId: otherSurvey.id },
      };
      const res = await anon<{ state: unknown; stateReset: boolean }>('POST', `/public/chatbots/${a.slug}/messages`, {
        sessionId: a.sessionId,
        message: '아무 입력',
        state: forged,
      });
      expect(res.status).toBe(200);
      expect(res.body.stateReset).toBe(true);
      expect((res.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();

      const rowsForOtherSurvey = await prisma.surveyResponse.findMany({ where: { surveyId: otherSurvey.id } });
      expect(rowsForOtherSurvey).toHaveLength(0);
    });

    it('문항 순번을 범위 밖(존재하지 않는 인덱스)으로 위조하면 봉투가 폐기되고 저장 0건이다', async () => {
      const a = await startSurveyTurn('범위밖');
      const forged = {
        version: 1,
        contextSession: null,
        surveySession: { ...a.session, questionIndex: 99 },
      };
      const res = await anon<{ state: unknown; stateReset: boolean }>('POST', `/public/chatbots/${a.slug}/messages`, {
        sessionId: a.sessionId,
        message: '아무 입력',
        state: forged,
      });
      expect(res.status).toBe(200);
      expect(res.body.stateReset).toBe(true);
      expect((res.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();

      // 최초 EXPOSED 1건 외에 추가로 적재된 답 행이 없어야 한다.
      const response = await prisma.surveyResponse.findFirst({ where: { chatbotId: a.chatbotId, sessionId: a.sessionId, surveyId: a.surveyId } });
      expect(response?.lastQuestionIndex).toBe(-1);
    });

    it('실제로 노출되지 않은 시작 시각(startedAt)을 지어내 문항을 앞질러 답해도, 서버 응답 행은 0건이다(핵심 위변조 방어)', async () => {
      const a = await startSurveyTurn('앞지르기');
      const fakeStartedAt = new Date(Date.now() - 60_000).toISOString(); // 실제로 서버에 노출 기록이 없는 시각
      const forged = {
        version: 1,
        contextSession: null,
        surveySession: { ...a.session, startedAt: fakeStartedAt, lastInteractedAt: fakeStartedAt, questionIndex: 2 }, // 마지막 문항(자유 텍스트)로 건너뜀
      };
      const res = await anon('POST', `/public/chatbots/${a.slug}/messages`, {
        sessionId: a.sessionId,
        message: '위조된 답변입니다',
        state: forged,
      });
      expect(res.status).toBe(200);

      // 지어낸 시작 시각으로는 행이 만들어지지 않는다(쓰기 키 = chatbotId·sessionId·surveyId·startedAt).
      const forgedRow = await prisma.surveyResponse.findUnique({
        where: { chatbotId_sessionId_surveyId_startedAt: { chatbotId: a.chatbotId, sessionId: a.sessionId, surveyId: a.surveyId, startedAt: new Date(fakeStartedAt) } },
      });
      expect(forgedRow).toBeNull();
      // 실제 노출 행(진짜 startedAt)에는 질문2에 대한 답이 적재되지 않았다 — lastQuestionIndex가 그대로다.
      const realRow = await prisma.surveyResponse.findUnique({
        where: { chatbotId_sessionId_surveyId_startedAt: { chatbotId: a.chatbotId, sessionId: a.sessionId, surveyId: a.surveyId, startedAt: new Date(a.session.startedAt) } },
      });
      expect(realRow?.lastQuestionIndex).toBe(-1);
    });

    it('위조된 시작 시각이 미래(+5분 허용오차 초과)면 봉투가 즉시 폐기된다(SURVEY_SESSION_EXPIRED)', async () => {
      const a = await startSurveyTurn('미래시각');
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      const forged = { version: 1, contextSession: null, surveySession: { ...a.session, startedAt: future, lastInteractedAt: future } };
      const res = await anon<{ state: unknown; stateReset: boolean }>('POST', `/public/chatbots/${a.slug}/messages`, {
        sessionId: a.sessionId,
        message: '아무 입력',
        state: forged,
      });
      expect(res.status).toBe(200);
      expect(res.body.stateReset).toBe(true);
      expect((res.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();
    });

    it('같은 세션의 동시(병렬) 완료 요청은 원자적으로 처리되어 완료 행이 정확히 1건만 남는다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('동시성');
      const intentId = await createIntent(chatbotId, '동시성_설문요청', ['동시성 설문 참여']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '동시성_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '동시성 설문 참여' });

      // 같은 상태(state)로 마지막 문항 응답을 동시에 2회 전송 — 경합 시 원자적 가드가 중복 적재를 막아야 한다.
      const [r1, r2] = await Promise.all([
        anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '5점', state: t0.body.state }),
        anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '5점', state: t0.body.state }),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      const responses = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id } });
      expect(responses).toHaveLength(1);
      expect(responses[0].status).toBe('COMPLETED');
      const answers = await prisma.surveyAnswer.findMany({ where: { responseId: responses[0].id } });
      // SCALE 1문항 — 중복 적재라면 2행이 됐을 것이다.
      expect(answers).toHaveLength(1);
    });
  });

  describe('3. 자유 텍스트 마스킹 — 금지어 → PII 순서로 마스킹 후에만 저장된다(FR-SV5-6)', () => {
    it('전화번호와 금지어가 섞인 자유 응답은 마스킹본만 저장되고, 응답 목록·CSV·오류 응답 어디에도 원문이 없다', async () => {
      const bannedWord = `설문금지어${Math.random().toString(36).slice(2, 6)}`;
      const bannedRes = await admin<{ id: string }>('POST', '/banned-words', { word: bannedWord, matchType: 'CONTAINS', policy: 'WARN', enabled: true });
      expect(bannedRes.status).toBe(201);

      const { chatbotId, slug } = await createChatbotWithChannel('마스킹');
      const intentId = await createIntent(chatbotId, '마스킹_설문요청', ['마스킹 설문 참여']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'TEXT', prompt: '의견을 남겨주세요.', required: true, maxLength: 200 }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '마스킹_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });

      const sessionId = randomUUID();
      const raw = `010-9876-5432 ${bannedWord} 제 연락처입니다`;
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '마스킹 설문 참여' });
      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: raw, state: t0.body.state });
      expect(t1.status).toBe(200);
      expect(JSON.stringify(t1.body)).not.toContain('010-9876-5432');
      expect(JSON.stringify(t1.body)).not.toContain(bannedWord);

      const answer = await prisma.surveyAnswer.findFirst({ where: { surveyId: survey.id, kind: 'ANSWERED' } });
      expect(answer?.textValue).toBeDefined();
      expect(answer?.textValue).not.toContain('010-9876-5432');
      expect(answer?.textValue).not.toContain(bannedWord);
      expect(answer?.textValue).not.toBe(raw);

      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const textAnswers = await admin<{ items: Array<{ text: string }> }>(
        'GET',
        `/chatbots/${chatbotId}/surveys/${survey.id}/text-answers?questionKey=${answer?.questionKey ?? ''}&from=${today}&to=${today}`,
      );
      expect(JSON.stringify(textAnswers.body)).not.toContain('010-9876-5432');
      expect(JSON.stringify(textAnswers.body)).not.toContain(bannedWord);

      const responsesList = await admin('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses?from=${today}&to=${today}`);
      expect(JSON.stringify(responsesList.body)).not.toContain('010-9876-5432');
      expect(JSON.stringify(responsesList.body)).not.toContain(bannedWord);

      const csv = await admin<string>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${today}&to=${today}`);
      expect(csv.body).not.toContain('010-9876-5432');
      expect(csv.body).not.toContain(bannedWord);
    });
  });

  describe('4. 통계 격리 — 설문 턴은 질문 순위·미응답 수집에서 제외된다(FR-SV10-5 · J-14)', () => {
    it('설문 응답 문구는 질문 순위(topQuestions/topUnansweredQuestions)에 나타나지 않고, 미응답 큐도 늘지 않는다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('질문순위격리');
      const intentId = await createIntent(chatbotId, '격리_설문요청', ['격리설문시작']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'SINGLE_CHOICE', prompt: '만족도설문전용선택문항', required: true, choices: [{ label: '설문선택지가' }, { label: '설문선택지나' }] }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '격리_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });

      const beforeUnanswered = await prisma.unansweredQuestion.count({ where: { chatbotId } });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '격리설문시작' });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '설문선택지가', state: t0.body.state });
      const afterUnanswered = await prisma.unansweredQuestion.count({ where: { chatbotId } });
      expect(afterUnanswered).toBe(beforeUnanswered);

      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const questions = await admin<{ topQuestions: Array<{ question: string }>; topUnansweredQuestions: Array<{ question: string }> }>(
        'GET',
        `/stats/questions?chatbotId=${chatbotId}&from=${today}&to=${today}`,
      );
      expect(questions.status).toBe(200);
      const allQuestionTexts = [...questions.body.topQuestions.map((q) => q.question), ...questions.body.topUnansweredQuestions.map((q) => q.question)];
      // '격리설문시작'은 설문을 호출한 일반 의도 매칭 턴(surveyTurn=false)이라 질문 순위에 나타나는 것이 맞다(제외 대상이 아님).
      expect(allQuestionTexts).toContain('격리설문시작');
      // '설문선택지가'는 설문 문항에 대한 응답 턴(surveyTurn=true)이라 질문 순위에서 제외되어야 한다.
      expect(allQuestionTexts).not.toContain('설문선택지가');
    });
  });

  describe('6. CSV 내보내기(P-13 · FR-SV7-2~5)', () => {
    it('기간(from/to) 미지정은 400이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('CSV기간필수');
      const survey = await createSurvey(chatbotId);
      const res = await admin('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES`);
      expect(res.status).toBe(400);
    });

    it('수식 인젝션 셀은 그대로 "="로 시작하지 않도록 방어된다(NFR-SVS5)', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('수식인젝션');
      const intentId = await createIntent(chatbotId, '인젝션_설문요청', ['인젝션설문시작']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'TEXT', prompt: '의견', required: true, maxLength: 200 }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '인젝션_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '인젝션설문시작' });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '=1+1(cmd)', state: t0.body.state });

      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const csv = await admin<string>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${today}&to=${today}`);
      expect(csv.status).toBe(200);
      expect(csv.body).not.toMatch(/[,\n]=1\+1\(cmd\)/); // 셀 선두가 원문 "="로 남아있지 않아야 한다(escapeCsvCell 방어)
    });

    it('한글 설문명은 Content-Disposition에 filename*(UTF-8 퍼센트 인코딩)으로 안전하게 실린다(ERR_INVALID_CHAR 회귀 방지)', async () => {
      const { chatbotId } = await createChatbotWithChannel('한글파일명');
      const survey = await createSurvey(chatbotId, { name: `한글설문명_특수/문자?포함_${Math.random().toString(36).slice(2, 6)}` });
      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const res = await admin<string>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${today}&to=${today}`);
      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toBeDefined();
      expect(String(disposition)).toContain("filename*=UTF-8''");
    });

    it('10,000행을 초과하면 X-Export-Truncated 헤더와 함께 최신 10,000행만 내려준다(FR-SV7-3)', async () => {
      const { chatbotId } = await createChatbotWithChannel('대량CSV');
      const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId } });
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] });
      await openSurvey(chatbotId, survey.id);

      const total = 10_001;
      const base = new Date('2026-01-15T03:00:00.000Z'); // 정오 KST 부근 — 10,001초를 빼도 같은 KST 날짜 안에 머문다.
      const batchSize = 1000;
      for (let start = 0; start < total; start += batchSize) {
        const end = Math.min(start + batchSize, total);
        const rows = [];
        for (let i = start; i < end; i++) {
          const startedAt = new Date(base.getTime() - i * 1000);
          rows.push({
            chatbotId,
            surveyId: survey.id,
            groupId: chatbot.groupId,
            sessionId: randomUUID(),
            channelType: 'WEB',
            structureVersion: 1,
            startedAt,
            status: 'COMPLETED',
            started: true,
            lastQuestionIndex: 0,
            lastInteractedAt: startedAt,
            completedAt: startedAt,
            dayBucket: startedAt.toISOString().slice(0, 10), // 근사(테스트 목적 — 아래 from/to도 같은 방식으로 맞춘다)
          });
        }
        await prisma.surveyResponse.createMany({ data: rows });
      }

      const dayBucket = base.toISOString().slice(0, 10);
      const res = await admin<string>('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${dayBucket}&to=${dayBucket}`);
      expect(res.status).toBe(200);
      expect(res.headers['x-export-truncated']).toBe('true');
      expect(Number(res.headers['x-export-total'])).toBeGreaterThanOrEqual(total);
      const dataLines = res.body.split(/\r\n/).filter((l) => l.length > 0);
      // BOM + 헤더 1행 + 데이터 최대 10,000행
      expect(dataLines.length).toBeLessThanOrEqual(10_001);
    }, 60_000);
  });

  describe('7. 구조 잠금 · 상태 전이 · 한도(P-5 · FR-SV2-3~6)', () => {
    it('응답이 달린 뒤 문구만 수정하면 200이고 structureVersion은 그대로다(AC-SV4-2)', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('문구수정');
      const intentId = await createIntent(chatbotId, '문구수정_설문요청', ['문구수정설문']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'SCALE', prompt: '원래 문구', required: true, scale: 'STAR_5' }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '문구수정_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '문구수정설문' });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '5점', state: t0.body.state });

      const detail = await admin<{ questions: Array<{ key: string; type: string; prompt: string; scale: string; required: boolean }>; structureVersion: number }>(
        'GET',
        `/chatbots/${chatbotId}/surveys/${survey.id}`,
      );
      expect(detail.body.structureVersion).toBe(1);
      const patchRes = await admin<{ structureVersion: number; questions: Array<{ prompt: string }> }>('PATCH', `/chatbots/${chatbotId}/surveys/${survey.id}`, {
        questions: [{ ...detail.body.questions[0], prompt: '바뀐 문구' }],
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.structureVersion).toBe(1);
      expect(patchRes.body.questions[0].prompt).toBe('바뀐 문구');
    });

    it('응답이 달린 뒤 구조(선택지 개수)를 바꾸면 409 SURVEY_STRUCTURE_LOCKED다(AC-SV4-2)', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('구조잠금');
      const intentId = await createIntent(chatbotId, '구조잠금_설문요청', ['구조잠금설문']);
      const survey = await createSurvey(chatbotId, {
        questions: [{ type: 'SINGLE_CHOICE', prompt: '선택', required: true, choices: [{ label: '가' }, { label: '나' }] }],
      });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '구조잠금_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '구조잠금설문' });
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '가', state: t0.body.state });

      const detail = await admin<{ questions: Array<{ key: string; type: string; prompt: string; required: boolean; choices: Array<{ key: string; label: string }> }> }>(
        'GET',
        `/chatbots/${chatbotId}/surveys/${survey.id}`,
      );
      const patchRes = await admin<{ code: string }>('PATCH', `/chatbots/${chatbotId}/surveys/${survey.id}`, {
        questions: [{ ...detail.body.questions[0], choices: [...detail.body.questions[0].choices, { label: '다' }] }],
      });
      expect(patchRes.status).toBe(409);
      expect(patchRes.body.code).toBe('SURVEY_STRUCTURE_LOCKED');
    });

    it('DRAFT에서 CLOSED로 직접 전이는 400 INVALID_STATUS_TRANSITION이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('상태전이위반');
      const survey = await createSurvey(chatbotId);
      const res = await admin<{ code: string }>('PATCH', `/chatbots/${chatbotId}/surveys/${survey.id}`, { status: 'CLOSED' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('챗봇당 설문 50개 한도를 넘으면 409 LIMIT_EXCEEDED다(SURVEY_LIMITS.perChatbotMax)', async () => {
      const { chatbotId } = await createChatbotWithChannel('설문한도');
      const chatbot = await prisma.chatbot.findUniqueOrThrow({ where: { id: chatbotId } });
      const rows = Array.from({ length: 50 }, (_, i) => ({
        chatbotId,
        name: `한도설문-${i}`,
        nameNormalized: `한도설문-${i}`.toLowerCase(),
        status: 'DRAFT',
        completionMessage: '감사합니다.',
        cancelKeywords: JSON.stringify(['그만']),
        sessionTimeoutMinutes: 30,
        questions: JSON.stringify([]),
        structureVersion: 1,
      }));
      await prisma.survey.createMany({ data: rows });
      void chatbot;
      const res = await admin<{ code: string }>('POST', `/chatbots/${chatbotId}/surveys`, { name: '한도초과설문', questions: [] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LIMIT_EXCEEDED');
    });
  });

  describe('8. 기간 · 상태 — 노출 차단과 진행 중 종료(J-19)', () => {
    async function setupSurveyNode(prefix: string, overrides: Record<string, unknown>) {
      const { chatbotId, slug } = await createChatbotWithChannel(prefix);
      const intentId = await createIntent(chatbotId, `${prefix}_설문요청`, [`${prefix}설문호출`]);
      const survey = await createSurvey(chatbotId, overrides);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: `${prefix}_설문노드`,
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      return { chatbotId, slug, surveyId: survey.id, callPhrase: `${prefix}설문호출` };
    }

    it('DRAFT 설문은 대화에서 시작되지 않고 저장 0건이다(고정 안내로 대체)', async () => {
      const { slug, surveyId, callPhrase } = await setupSurveyNode('DRAFT차단', {});
      const sessionId = randomUUID();
      const res = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: callPhrase });
      expect(res.status).toBe(200);
      expect((res.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();
      const rows = await prisma.surveyResponse.findMany({ where: { surveyId } });
      expect(rows).toHaveLength(0);
    });

    it('CLOSED 설문은 대화에서 시작되지 않고 저장 0건이다', async () => {
      const setup = await setupSurveyNode('CLOSED차단', {});
      await admin('PATCH', `/chatbots/${setup.chatbotId}/surveys/${setup.surveyId}`, { status: 'OPEN' });
      await admin('PATCH', `/chatbots/${setup.chatbotId}/surveys/${setup.surveyId}`, { status: 'CLOSED' });
      const sessionId = randomUUID();
      const res = await anon('POST', `/public/chatbots/${setup.slug}/messages`, { sessionId, message: setup.callPhrase });
      expect(res.status).toBe(200);
      const rows = await prisma.surveyResponse.findMany({ where: { surveyId: setup.surveyId } });
      expect(rows).toHaveLength(0);
    });

    it('activeFrom이 미래면 기간 전이라 시작되지 않는다(OUT_OF_PERIOD)', async () => {
      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      const setup = await setupSurveyNode('시작전', { activeFrom: future });
      await admin('PATCH', `/chatbots/${setup.chatbotId}/surveys/${setup.surveyId}`, { status: 'OPEN' });
      const sessionId = randomUUID();
      await anon('POST', `/public/chatbots/${setup.slug}/messages`, { sessionId, message: setup.callPhrase });
      const rows = await prisma.surveyResponse.findMany({ where: { surveyId: setup.surveyId } });
      expect(rows).toHaveLength(0);
    });

    it('진행 중 세션 중에 관리자가 설문을 마감하면 다음 턴에 종료 안내와 함께 ABANDONED(CLOSED)로 적재된다(§1.3.3 "설문 수정·마감 중 진행")', async () => {
      // ⚠ activeTo(OffsetDateTimeSchema)는 분 단위로 내림 정규화된다(packages/shared-types/src/
      // deploy-schedule.ts truncateToMinute) — 초 단위로 가까운 미래를 주면 "현재 분의 시작"으로
      // 내림돼 이미 지난 시각이 될 수 있다(실측으로 확인한 간헐 실패 원인). 또한 대화 번들은 60초
      // TTL로 캐시되며 SurveysService 경로로 쓸 때만 즉시 invalidate된다(dialogue-bundle.service.ts
      // §8.1) — DB를 직접 건드리면(raw Prisma) 캐시가 무효화되지 않아 다음 턴에 반영되지 않는다.
      // 그래서 activeTo 대신 실제 PATCH API(status: CLOSED)로 마감해 캐시 무효화까지 함께 검증한다
      // (대기 시간 0, 결정적).
      const setup = await setupSurveyNode('마감중진행', {});
      await admin('PATCH', `/chatbots/${setup.chatbotId}/surveys/${setup.surveyId}`, { status: 'OPEN' });
      const sessionId = randomUUID();
      const t0 = await anon<{ state: unknown }>('POST', `/public/chatbots/${setup.slug}/messages`, { sessionId, message: setup.callPhrase });
      expect((t0.body.state as { surveySession?: unknown }).surveySession).toBeDefined();

      const closeRes = await admin('PATCH', `/chatbots/${setup.chatbotId}/surveys/${setup.surveyId}`, { status: 'CLOSED' });
      expect(closeRes.status).toBe(200);

      const t1 = await anon<{ state: unknown }>('POST', `/public/chatbots/${setup.slug}/messages`, { sessionId, message: '아무 입력', state: t0.body.state });
      expect(t1.status).toBe(200);
      expect((t1.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();

      const response = await prisma.surveyResponse.findFirst({ where: { chatbotId: setup.chatbotId, sessionId, surveyId: setup.surveyId } });
      expect(response?.status).toBe('ABANDONED');
      expect(response?.endReason).toBe('CLOSED');
    }, 15_000);
  });

  describe('9. 삭제 · 참조 무결성(FR-SV2-7 · FR-SV8-4)', () => {
    it('응답이 있는 설문은 삭제할 수 없다(409 SURVEY_HAS_RESPONSES)', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('응답있는삭제');
      const intentId = await createIntent(chatbotId, '응답삭제_설문요청', ['응답삭제설문']);
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] });
      await openSurvey(chatbotId, survey.id);
      const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '응답삭제_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      const startRes = await anon<{ state: unknown }>('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '응답삭제설문' });
      void startRes;

      // SURVEY_IN_USE(참조 노드 존재)가 SURVEY_HAS_RESPONSES보다 먼저 걸리므로(§13.1 삭제 순서),
      // 참조 노드를 먼저 지워 "응답은 있고 참조는 없는" 상태를 만든 뒤 재시도한다.
      await admin('DELETE', `/chatbots/${chatbotId}/dialog-nodes/${nodeRes.body.id}`);

      const res = await admin<{ code: string }>('DELETE', `/chatbots/${chatbotId}/surveys/${survey.id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SURVEY_HAS_RESPONSES');
    });

    it('설문·설문 응답이 있는 챗봇은 영구삭제 사전검사에서 409 CHATBOT_HAS_CHILDREN(설문 항목 포함)으로 막힌다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('영구삭제사전검사');
      const chatbotDetail = await admin<{ name: string }>('GET', `/chatbots/${chatbotId}`);
      const intentId = await createIntent(chatbotId, '영구삭제_설문요청', ['영구삭제설문']);
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] });
      await openSurvey(chatbotId, survey.id);
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '영구삭제_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const sessionId = randomUUID();
      await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId, message: '영구삭제설문' });

      await admin('DELETE', `/chatbots/${chatbotId}`); // 보관(archive) 전환
      const res = await admin<{ code: string; message: string }>('POST', `/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotDetail.body.name });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CHATBOT_HAS_CHILDREN');
      expect(res.body.message).toContain('설문');
    });
  });

  describe('10. v1 SURVEY(자유 문자열) — 실행 안 함 · 복사 제외(P-15)', () => {
    it('v1 SURVEY 아웃풋이 있는 노드를 복사하면 사본에서 제외되고 응답에 제외 건수가 실린다(FR-SV1-5)', async () => {
      const { chatbotId } = await createChatbotWithChannel('v1복사제외');
      // v1은 쓰기 가드가 막으므로, 시드와 같은 형태로 기존 행을 직접 만든다(검증 우회가 아니라 "이미 존재하는 v1 데이터"를 재현).
      const node = await prisma.dialogNode.create({
        data: {
          chatbotId,
          name: 'v1설문보유노드',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          outputs: JSON.stringify([{ type: 'SURVEY', payload: { surveyId: 'legacy-free-key' } }, { type: 'TEXT', payload: { text: '안내' } }]),
        },
      });
      const res = await admin<{ excludedLegacySurveyOutputCount: number }>('POST', `/chatbots/${chatbotId}/dialog-nodes/${node.id}/copy`, {});
      expect(res.status).toBe(201);
      expect(res.body.excludedLegacySurveyOutputCount).toBe(1);
    });
  });

  describe('11. 시뮬레이터 · TC — 저장 0건 · 상태/기간 무관 결정적 진행(P-14)', () => {
    it('VIEWER가 설문 미리보기(surveyPreview)로 DRAFT 설문을 진행해도 저장은 0건이다(AC-SV6-1/6-2)', async () => {
      const { chatbotId } = await createChatbotWithChannel('시뮬레이터미리보기');
      const intentId = await createIntent(chatbotId, '시뮬_설문요청', ['시뮬설문시작']);
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] }); // DRAFT 그대로
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '시뮬_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });

      const t0 = await viewer<{ state: unknown; surveyStep?: { outcomes: string[]; preview: boolean; saved: boolean } }>(
        'POST',
        `/chatbots/${chatbotId}/simulate`,
        { message: '시뮬설문시작', surveyPreview: true },
      );
      expect(t0.status).toBe(200);
      expect((t0.body.state as { surveySession?: unknown }).surveySession).toBeDefined();
      expect(t0.body.surveyStep?.outcomes).toContain('STARTED');
      expect(t0.body.surveyStep?.saved).toBe(false);

      const rows = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id } });
      expect(rows).toHaveLength(0);
    });

    it('surveyPreview 없이 DRAFT 설문을 시뮬레이션하면 설문이 시작되지 않는다(실제 상태를 따른다)', async () => {
      const { chatbotId } = await createChatbotWithChannel('시뮬레이터실상태');
      const intentId = await createIntent(chatbotId, '시뮬실_설문요청', ['시뮬실설문시작']);
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] });
      await admin('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: '시뮬실_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });
      const t0 = await admin<{ state: unknown }>('POST', `/chatbots/${chatbotId}/simulate`, { message: '시뮬실설문시작' });
      expect(t0.status).toBe(200);
      expect((t0.body.state as { surveySession?: unknown }).surveySession).toBeUndefined();
    });

    it('TC 실행은 상태·기간과 무관하게(surveyPreview) 설문을 진행하고 결과에 surveyPreviewA가 기록되며 저장은 0건이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('TC설문');
      const intentId = await createIntent(chatbotId, 'TC_설문요청', ['TC설문시작']);
      const survey = await createSurvey(chatbotId, { questions: [{ type: 'SCALE', prompt: '만족도', required: true, scale: 'STAR_5' }] });
      await admin('PATCH', `/chatbots/${chatbotId}/surveys/${survey.id}`, { status: 'CLOSED' }); // 굳이 CLOSED — 실제로는 진행 불가 상태
      const nodeRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/dialog-nodes`, {
        name: 'TC_설문노드',
        intentIds: [intentId],
        outputs: [{ type: 'SURVEY', payload: { version: 2, surveyId: survey.id } }],
      });

      const setRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets`, { name: 'No27 설문 TC세트' });
      expect(setRes.status).toBe(201);
      const setId = setRes.body.id;
      const caseRes = await admin<{ id: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/cases`, {
        messages: ['TC설문시작'],
        expectedKind: 'NODE',
        expectedTargetId: nodeRes.body.id,
      });
      expect(caseRes.status).toBe(201);

      const runRes = await admin<{ runId: string }>('POST', `/chatbots/${chatbotId}/test-sets/${setId}/runs`, { overlaySource: 'NONE', useRag: false });
      expect(runRes.status).toBe(202);
      const runId = runRes.body.runId;

      const start = Date.now();
      let status = 'QUEUED';
      while (Date.now() - start < 20_000) {
        const statusRes = await admin<{ status: string }>('GET', `/chatbots/${chatbotId}/test-runs/${runId}`);
        status = statusRes.body.status;
        if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED') break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(status).toBe('SUCCEEDED');

      const resultsRes = await admin<{ items: Array<{ id: string; surveyPreviewA?: boolean }> }>('GET', `/chatbots/${chatbotId}/test-runs/${runId}/results`);
      expect(resultsRes.body.items.length).toBe(1);
      expect(resultsRes.body.items[0].surveyPreviewA).toBe(true);

      const rows = await prisma.surveyResponse.findMany({ where: { surveyId: survey.id } });
      expect(rows).toHaveLength(0); // CLOSED 상태였지만 TC는 결정적으로 진행됐고, 저장은 없다.
    }, 30_000);
  });

  describe('13. 권한(P-12 — 신규 권한 0종)', () => {
    it('설문 정의 쓰기는 dialogue:write다 — EDITOR는 가능, VIEWER는 403이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('권한정의');
      const editorRes = await editor<{ id: string }>('POST', `/chatbots/${chatbotId}/surveys`, {
        name: `에디터설문-${Math.random().toString(36).slice(2, 6)}`,
        questions: [],
      });
      expect(editorRes.status).toBe(201);

      const viewerRes = await viewer('POST', `/chatbots/${chatbotId}/surveys`, { name: `뷰어설문-${Math.random().toString(36).slice(2, 6)}`, questions: [] });
      expect(viewerRes.status).toBe(403);
    });

    it('결과·CSV 조회는 chatbot:read다 — VIEWER도 200이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('권한결과');
      const survey = await createSurvey(chatbotId);
      const today = toKstDayBucket(new Date()); // 제품의 dayBucket(KST)과 같은 기준 — UTC로 자르면 KST 자정~09시에 날짜가 어긋난다
      const summaryRes = await viewer('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/stats/summary?from=${today}&to=${today}`);
      expect(summaryRes.status).toBe(200);
      const csvRes = await viewer('GET', `/chatbots/${chatbotId}/surveys/${survey.id}/responses/export?kind=RESPONSES&from=${today}&to=${today}`);
      expect(csvRes.status).toBe(200);
    });

    it('비로그인 요청은 401이다', async () => {
      const { chatbotId } = await createChatbotWithChannel('비로그인');
      const survey = await createSurvey(chatbotId);
      const res = await noAuth('GET', `/chatbots/${chatbotId}/surveys/${survey.id}`);
      expect(res.status).toBe(401);
    });
  });

  describe('14. 설문이 없는 턴의 추가 쿼리 0건(No.29 jest.spyOn 선례)', () => {
    it('설문 세션이 없는 일반 대화 턴에서는 설문 응답 쓰기 서비스의 Prisma 호출이 0건이다', async () => {
      const { chatbotId, slug } = await createChatbotWithChannel('추가쿼리없음');
      await createIntent(chatbotId, '일반의도', ['안녕하세요']);
      // 이 챗봇에 설문이 존재해도(번들에는 있지만) 이번 턴이 그 설문을 건드리지 않으면 추가 쓰기가 없어야 한다.
      await createSurvey(chatbotId);

      const createSpy = jest.spyOn(prisma.surveyResponse, 'create');
      const createManySpy = jest.spyOn(prisma.surveyResponse, 'createMany');
      const updateSpy = jest.spyOn(prisma.surveyResponse, 'update');
      const updateManySpy = jest.spyOn(prisma.surveyResponse, 'updateMany');
      const answerCreateSpy = jest.spyOn(prisma.surveyAnswer, 'createMany');
      try {
        const res = await anon('POST', `/public/chatbots/${slug}/messages`, { sessionId: randomUUID(), message: '안녕하세요' });
        expect(res.status).toBe(200);
        expect(createSpy).not.toHaveBeenCalled();
        expect(createManySpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(updateManySpy).not.toHaveBeenCalled();
        expect(answerCreateSpy).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
        createManySpy.mockRestore();
        updateSpy.mockRestore();
        updateManySpy.mockRestore();
        answerCreateSpy.mockRestore();
      }
    });
  });
});
