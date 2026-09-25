import { execSync } from 'node:child_process';
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
 * 피드백 기반 개선 루프(No.44) 통합 테스트 — `docs/requirements/feedback-loop.md`(AC-FB1~FB8) ·
 * `docs/02-spec/feedback-loop-설계.md` §21 대비. 순수 함수 판정은 `feedback/lib/*.spec.ts`·
 * `stats/lib/feedback-stats.spec.ts`·`learning/lib/collect-decision.spec.ts`가 커버한다 — 이
 * 파일은 HTTP 계약 레벨(위조 방어·레이트리밋 분리·큐 편입·통계 엔드포인트)을 다룬다.
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

let authCookie = '';
let viewerCookie = '';
let agentCookie = '';

function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  opts: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const cookie = opts.cookie !== undefined ? opts.cookie : authCookie;
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
          resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers, rawBody: data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('피드백 기반 개선 루프(No.44) 통합 테스트', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-feedback-test-'));
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
    viewerCookie = await loginAs(baseUrl, 'VIEWER');
    agentCookie = await loginAs(baseUrl, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await safeCleanupTmpDir(tmpDir);
  });

  async function createGroup(): Promise<string> {
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbot-groups`, {
      name: `피드백 테스트 그룹 ${Math.random().toString(36).slice(2, 8)}`,
    });
    return res.body.id as string;
  }

  /** feedbackEnabled를 켠 공개 챗봇을 만든다(기본은 꺼짐, §5.1). */
  async function setupPublicChatbot(opts: { feedbackEnabled: boolean } = { feedbackEnabled: true }): Promise<{ chatbotId: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `fb-bot-${suffix}`;
    const createRes = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/chatbots`, { groupId, name: '피드백 테스트봇', slug });
    const chatbotId = createRes.body.id as string;
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/channels/WEB`, {
      enabled: true,
      config: { allowedOrigins: [], greetingMessage: '안녕하세요', feedbackEnabled: opts.feedbackEnabled },
    });
    return { chatbotId, slug };
  }

  /** 👎 편입 시나리오는 "답변된 턴"이 필요하다 — 폴백(미응답) 턴은 ALREADY_UNANSWERED로 큐 제외된다(§10.2). */
  async function createFaq(chatbotId: string, question: string, answer: string): Promise<void> {
    const res = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/faqs`, { category: 'FAQ', question, answer });
    expect(res.status).toBe(201);
  }

  /**
   * fire-and-forget 로그 쓰기(conversation-log.service.ts) — 대화 응답은 ConversationLog INSERT를
   * await하지 않고 반환한다. 메시지 전송 직후 곧바로 평가 PUT을 보내면(특히 동시 요청 시험) 드물게
   * 로그 행이 아직 커밋되지 않아 404 FEEDBACK_TARGET_NOT_FOUND로 흔들릴 수 있다 — 이 파일의 기존
   * 규약(폴링)을 따라 로그 행 존재를 확인한 뒤에만 평가 요청을 시작한다.
   */
  async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, opts: { maxWaitMs?: number; intervalMs?: number; label?: string } = {}): Promise<T> {
    const maxWaitMs = opts.maxWaitMs ?? 5000;
    const intervalMs = opts.intervalMs ?? 100;
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const v = await fn();
      if (predicate(v)) return v;
      if (Date.now() >= deadline) throw new Error(`pollUntil 시간 초과${opts.label ? ` (${opts.label})` : ''}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function waitForLogRow(messageId: string): Promise<void> {
    await pollUntil(() => prisma.conversationLog.findUnique({ where: { id: messageId } }), (row) => row !== null, { label: `conversationLog ${messageId}` });
  }

  it('AC-FB1-1: 기능 꺼짐(feedbackEnabled=false)이면 응답에 feedback 키가 없다(바이트 동일 계약)', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: false });
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '안녕하세요',
      features: ['feedback-v1'],
    });
    expect(res.status).toBe(200);
    expect('feedback' in res.body).toBe(false);
  });

  it('AC-FB1-1: 위젯이 feedback-v1을 선언하지 않으면 기능이 켜져 있어도 응답에 feedback 키가 없다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const res = await jsonRequest<Record<string, unknown>>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '안녕하세요' });
    expect(res.status).toBe(200);
    expect('feedback' in res.body).toBe(false);
  });

  it('AC-FB2-1/2: 기능 켜짐 + feedback-v1 선언 시 응답에 feedback.rateable=true가 실린다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const res = await jsonRequest<{ messageId: string; feedback?: { rateable: boolean } }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '안녕하세요',
      features: ['feedback-v1'],
    });
    expect(res.status).toBe(200);
    expect(res.body.feedback).toEqual({ rateable: true });
    expect(res.body.messageId).toBeTruthy();
  });

  it('AC-FB3-2/3: 평가 저장(UP) → 같은 값 재요청(NOOP) → 값 변경(DOWN)이 모두 200이다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const sendRes = await jsonRequest<{ messageId: string; feedback?: { rateable: boolean } }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '해외배송 되나요',
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);
    expect(sendRes.body.feedback).toEqual({ rateable: true });

    const up1 = await jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, {
      sessionId,
      rating: 'UP',
    });
    expect(up1.status).toBe(200);
    expect(up1.body.rating).toBe('UP');

    // 같은 값 재요청 — NOOP, 여전히 200.
    const up2 = await jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, {
      sessionId,
      rating: 'UP',
    });
    expect(up2.status).toBe(200);

    // 값 변경 — CHANGE.
    const down = await jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, {
      sessionId,
      rating: 'DOWN',
    });
    expect(down.status).toBe(200);
    expect(down.body.rating).toBe('DOWN');

    const ledgerRow = await prisma.messageFeedback.findUnique({ where: { conversationLogId: messageId } });
    expect(ledgerRow?.rating).toBe('DOWN');
    expect(ledgerRow?.changeCount).toBe(1);
  });

  it('AC-FB3-1: 위조 4종(다른 세션·다른 슬러그·없는 UUID·비UUID)이 전부 같은 404 FEEDBACK_TARGET_NOT_FOUND다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const otherBot = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const otherSessionId = '66666666-6666-4666-8666-666666666666';
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '해외배송 되나요',
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);

    const wrongSession = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId: otherSessionId, rating: 'UP' });
    const wrongSlug = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${otherBot.slug}/messages/${messageId}/feedback`, { sessionId, rating: 'UP' });
    const missingId = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/99999999-9999-4999-8999-999999999999/feedback`, {
      sessionId,
      rating: 'UP',
    });
    const nonUuid = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/not-a-uuid/feedback`, { sessionId, rating: 'UP' });

    for (const res of [wrongSession, wrongSlug, missingId, nonUuid]) {
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('FEEDBACK_TARGET_NOT_FOUND');
    }
    // 문구·구조가 완전히 같다(존재 오라클 방지, NFR-FBS1).
    expect(wrongSession.rawBody).toBe(wrongSlug.rawBody);
    expect(missingId.rawBody).toBe(nonUuid.rawBody);
  });

  it('기능 꺼진 챗봇에 평가 요청 시 같은 404 FEEDBACK_TARGET_NOT_FOUND다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: false });
    const sessionId = '77777777-7777-4777-8777-777777777777';
    const res = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/99999999-9999-4999-8999-999999999999/feedback`, {
      sessionId,
      rating: 'UP',
    });
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('FEEDBACK_TARGET_NOT_FOUND');
  });

  it('AC-FB4-1/2 · FR-FB6-6: 👎 확정 시 같은 요청 안에서 학습현황(NEGATIVE_FEEDBACK) 큐에 즉시 편입된다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '88888888-8888-4888-8888-888888888888';
    const question = `이 답변이 이상해요 ${Math.random().toString(36).slice(2, 8)}`;
    // 👎 편입은 "답변된" 턴에서만 일어난다(폴백은 이미 UNANSWERED로 수집됨 — ALREADY_UNANSWERED).
    await createFaq(chatbotId, question, '이런 답변을 드립니다.');
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: question,
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);

    const down = await jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, {
      sessionId,
      rating: 'DOWN',
    });
    expect(down.status).toBe(200);

    // 편입은 응답 전에 await되므로(FR-FB6-6) 폴링 없이 바로 조회해도 보인다.
    const listRes = await jsonRequest<{ items: Array<{ questionText: string; source?: string }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions?source=NEGATIVE_FEEDBACK`,
    );
    expect(listRes.status).toBe(200);
    const found = listRes.body.items.find((i) => i.questionText === question);
    expect(found).toBeDefined();
    expect(found?.source).toBe('NEGATIVE_FEEDBACK');

    const ledgerRow = await prisma.messageFeedback.findUnique({ where: { conversationLogId: messageId } });
    expect(ledgerRow?.queueOutcome).toBe('QUEUED');
    expect(ledgerRow?.queueItemId).toBeTruthy();
  });

  it('AC-FB5-4: "직접 수정 완료"는 NEGATIVE_FEEDBACK만 허용되고, UNANSWERED 항목은 400이다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = '99999999-9999-4999-8999-999999999999';
    const question = `직접수정완료테스트 ${Math.random().toString(36).slice(2, 8)}`;
    await createFaq(chatbotId, question, '이런 답변을 드립니다.');
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: question,
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);
    await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'DOWN' });

    const listRes = await jsonRequest<{ items: Array<{ id: string; questionText: string }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions?source=NEGATIVE_FEEDBACK`,
    );
    const item = listRes.body.items.find((i) => i.questionText === question)!;
    expect(item).toBeDefined();

    // VIEWER는 dialogue:write가 없어 403.
    const forbidden = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${item.id}/mark-addressed`, {}, { cookie: viewerCookie });
    expect(forbidden.status).toBe(403);

    const marked = await jsonRequest<{ status: string; resolvedDirectly?: boolean }>(
      'POST',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${item.id}/mark-addressed`,
      {},
    );
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe('RESOLVED');
    expect(marked.body.resolvedDirectly).toBe(true);

    // UNANSWERED 항목(폴백 턴)에는 400 INVALID_STATUS_TRANSITION.
    const fallbackSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId: fallbackSessionId, message: `모르는질문 ${Math.random()}` });
    // 미응답 수집도 fire-and-forget(record() 성공 뒤 수집기 호출)이라 즉시 조회하면 드물게 비어
    // 있을 수 있다 — 폴링으로 견고화한다(이 파일 상단 waitForLogRow와 같은 근거).
    const unansweredList = await pollUntil(
      () => jsonRequest<{ items: Array<{ id: string }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions?source=UNANSWERED`),
      (res) => res.body.items.length > 0,
      { label: 'unanswered-questions UNANSWERED 재유입' },
    );
    expect(unansweredList.body.items.length).toBeGreaterThan(0);
    const unansweredId = unansweredList.body.items[0].id;
    const badTransition = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${unansweredId}/mark-addressed`, {});
    expect(badTransition.status).toBe(400);
    expect((badTransition.body as { code: string }).code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('AC-FB3-5: 평가 레이트리밋(fb-key)이 대화 session 버킷과 분리돼 평가 폭주 후에도 전송은 200이다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '평가 폭주 테스트',
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);

    // fb-key:msg:{messageId} 기본 한도 10/분 — 11번째는 429여야 하지만, 대화 전송 자체는 영향받지 않는다.
    let sawRateLimited = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, {
        sessionId,
        rating: i % 2 === 0 ? 'UP' : 'DOWN',
      });
      if (res.status === 429) sawRateLimited = true;
    }
    expect(sawRateLimited).toBe(true);

    const afterBurst = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message: '다음 질문입니다' });
    expect(afterBurst.status).toBe(200);
  });

  it('AC-FB6-1/AC-FB8-1: GET /stats/feedback이 평가 수·긍정률을 반환한다(대시보드 무변경)', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    for (let i = 0; i < 3; i += 1) {
      const res = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
        sessionId,
        message: `질문 ${i} ${Math.random()}`,
        features: ['feedback-v1'],
      });
      await waitForLogRow(res.body.messageId);
      await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${res.body.messageId}/feedback`, {
        sessionId,
        rating: i === 0 ? 'DOWN' : 'UP',
      });
    }

    const statsRes = await jsonRequest<{
      totals: { upCount: number; downCount: number; ratedCount: number; offeredCount: number; positiveRate: number | null };
    }>('GET', `${baseUrl}/stats/feedback?chatbotId=${chatbotId}`, undefined, { cookie: viewerCookie });
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totals.upCount).toBe(2);
    expect(statsRes.body.totals.downCount).toBe(1);
    expect(statsRes.body.totals.ratedCount).toBe(3);
    expect(statsRes.body.totals.offeredCount).toBeGreaterThanOrEqual(3);
    expect(statsRes.body.totals.positiveRate).toBeCloseTo(2 / 3);
  });

  it('AGENT(dialogue:* 없음)는 mark-addressed에 접근할 수 없다(403)', async () => {
    const { chatbotId } = await setupPublicChatbot({ feedbackEnabled: true });
    const res = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/00000000-0000-4000-8000-000000000000/mark-addressed`, {}, { cookie: agentCookie });
    expect(res.status).toBe(403);
  });

  it('영구삭제 사전검사에 답변 평가가 포함된다(409, 삭제 차단)', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '삭제방지테스트',
      features: ['feedback-v1'],
    });
    await waitForLogRow(sendRes.body.messageId);
    const feedbackPut = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${sendRes.body.messageId}/feedback`, { sessionId, rating: 'UP' });
    expect(feedbackPut.status).toBe(200);

    await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ARCHIVED' });
    const chatbotRes = await jsonRequest<{ name: string }>('GET', `${baseUrl}/chatbots/${chatbotId}`);
    const deleteRes = await jsonRequest('POST', `${baseUrl}/chatbots/${chatbotId}/permanent-delete`, { confirmName: chatbotRes.body.name });
    expect(deleteRes.status).toBe(409);
    expect((deleteRes.body as { code: string }).code).toBe('CHATBOT_HAS_CHILDREN');
    expect((deleteRes.body as { message: string }).message).toContain('답변 평가');
  });

  // ── [test-automation 추가 — 실제 동시 요청, 실 SQLite DB] AC-FB3-7 · 리뷰 공백 ──────────────

  it('AC-FB3-7: 같은 메시지에 👎 2건을 동시에 보내면 원장 1행 · 큐 기여(편입) 1회로 수렴한다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'e0000000-0000-4000-8000-000000000001';
    const question = `동시좋아요싫어요테스트 ${Math.random().toString(36).slice(2, 8)}`;
    await createFaq(chatbotId, question, '이런 답변을 드립니다.');
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: question,
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);

    const [first, second] = await Promise.all([
      jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'DOWN' }),
      jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'DOWN' }),
    ]);

    // 둘 다 성공한다(멱등 — 한쪽은 CREATE, 다른 쪽은 같은 값 NOOP 또는 재시도 후 NOOP).
    expect([first.status, second.status]).toEqual([200, 200]);

    const ledgerRows = await prisma.messageFeedback.findMany({ where: { conversationLogId: messageId } });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].rating).toBe('DOWN');
    expect(ledgerRows[0].queueOutcome).toBe('QUEUED');

    const listRes = await jsonRequest<{ items: Array<{ id: string; questionText: string; source?: string; occurredCount: number }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions?source=NEGATIVE_FEEDBACK`,
    );
    const found = listRes.body.items.find((i) => i.questionText === question);
    expect(found).toBeDefined();
    // 큐 기여는 메시지당 최대 1회(선점 상태 기계) — 동시에 두 요청이 와도 occurredCount는 1이다.
    expect(found?.occurredCount).toBe(1);
    expect(ledgerRows[0].queueItemId).toBe(found?.id ?? ledgerRows[0].queueItemId);
  });

  it('서로 다른 값(UP/DOWN)을 동시에 CREATE해도 원장은 1행으로 수렴하고 changeCount가 일관된다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'e0000000-0000-4000-8000-000000000002';
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '동시생성경쟁테스트',
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);

    const [first, second] = await Promise.all([
      jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'UP' }),
      jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating: 'DOWN' }),
    ]);

    // 둘 다 성공해야 한다 — 하나는 CREATE(P2002 시 재시도), 다른 하나는 CHANGE(CAS)로 수렴한다.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const ledgerRows = await prisma.messageFeedback.findMany({ where: { conversationLogId: messageId } });
    expect(ledgerRows).toHaveLength(1);
    // 최초 CREATE(0회) + 그 뒤 값이 다른 CHANGE 1회 = changeCount 1로 일관된다(경쟁 결과와 무관하게).
    expect(ledgerRows[0].changeCount).toBe(1);
    expect(['UP', 'DOWN']).toContain(ledgerRows[0].rating);
  });

  it('동시 요청이 메시지당 5회 변경 한도(CAS)를 우회하지 못한다', async () => {
    const { slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const sessionId = 'e0000000-0000-4000-8000-000000000003';
    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId,
      message: '변경한도우회테스트',
      features: ['feedback-v1'],
    });
    const messageId = sendRes.body.messageId;
    await waitForLogRow(messageId);
    const put = (rating: 'UP' | 'DOWN'): Promise<ApiResponse<{ rating: string }>> =>
      jsonRequest<{ rating: string }>('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${messageId}/feedback`, { sessionId, rating });

    // 순차적으로 changeCount를 정확히 상한(기본 5)까지 채운다 — 결정적 사전 상태.
    await expect(put('UP')).resolves.toMatchObject({ status: 200 }); // CREATE(changeCount=0)
    await expect(put('DOWN')).resolves.toMatchObject({ status: 200 }); // 1
    await expect(put('UP')).resolves.toMatchObject({ status: 200 }); // 2
    await expect(put('DOWN')).resolves.toMatchObject({ status: 200 }); // 3
    await expect(put('UP')).resolves.toMatchObject({ status: 200 }); // 4
    await expect(put('DOWN')).resolves.toMatchObject({ status: 200 }); // 5 (상한 도달, 현재값 DOWN)

    const beforeConcurrent = await prisma.messageFeedback.findUnique({ where: { conversationLogId: messageId } });
    expect(beforeConcurrent?.changeCount).toBe(5);
    expect(beforeConcurrent?.rating).toBe('DOWN');

    // 상한에 도달한 상태에서 서로 다른 값(UP)으로의 변경 시도를 동시에 3건 보낸다 — 전부 409여야 한다.
    const results = await Promise.all([put('UP'), put('UP'), put('UP')]);
    for (const res of results) {
      expect(res.status).toBe(409);
      expect((res.body as unknown as { code: string }).code).toBe('FEEDBACK_CLOSED');
    }

    const afterConcurrent = await prisma.messageFeedback.findUnique({ where: { conversationLogId: messageId } });
    // 동시 요청이 몰려도 changeCount는 상한(5)을 넘지 않고, 값도 바뀌지 않는다(우회 불가).
    expect(afterConcurrent?.changeCount).toBe(5);
    expect(afterConcurrent?.rating).toBe('DOWN');
  });

  // ── [test-automation 추가] AC-FB5-1/2/5 백엔드 추적표 공백 메우기 ──────────────────────

  it('AC-FB5-1/2/5: source 미지정 목록은 두 소스를 모두 반환하고, 요약 bySource·상세 매칭 대상 삭제됨 표시가 맞다', async () => {
    const { chatbotId, slug } = await setupPublicChatbot({ feedbackEnabled: true });
    const negSessionId = 'e0000000-0000-4000-8000-000000000004';
    const unansweredSessionId = 'e0000000-0000-4000-8000-000000000005';
    const question = `배송추적테스트 ${Math.random().toString(36).slice(2, 8)}`;
    const faqRes = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots/${chatbotId}/faqs`, {
      category: 'FAQ',
      question,
      answer: '배송은 3일 걸립니다.',
    });
    expect(faqRes.status).toBe(201);
    const faqId = faqRes.body.id;

    const sendRes = await jsonRequest<{ messageId: string }>('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId: negSessionId,
      message: question,
      features: ['feedback-v1'],
    });
    await waitForLogRow(sendRes.body.messageId);
    const down = await jsonRequest('PUT', `${baseUrl}/public/chatbots/${slug}/messages/${sendRes.body.messageId}/feedback`, {
      sessionId: negSessionId,
      rating: 'DOWN',
    });
    expect(down.status).toBe(200);

    // 미응답(UNANSWERED) 소스도 하나 만든다 — 두 소스가 함께 존재하는 상태를 만든다.
    await jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, {
      sessionId: unansweredSessionId,
      message: `모르는질문AC5 ${Math.random()}`,
    });

    // AC-FB5-5: 요약이 소스별 대기 수를 각각 보여준다.
    const summary = await pollUntil(
      () => jsonRequest<{ bySource: Record<string, { pendingCount: number }> }>('GET', `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/summary`),
      (res) => res.body.bySource.NEGATIVE_FEEDBACK.pendingCount >= 1 && res.body.bySource.UNANSWERED.pendingCount >= 1,
      { label: 'summary bySource 반영' },
    );
    expect(summary.body.bySource.NEGATIVE_FEEDBACK.pendingCount).toBe(1);
    expect(summary.body.bySource.UNANSWERED.pendingCount).toBe(1);

    // AC-FB5-1: source 미지정 목록은 두 소스 항목이 함께 나온다(기존 UNANSWERED 전용 호출도 회귀 없음).
    const allList = await jsonRequest<{ items: Array<{ id: string; questionText: string; source?: string }> }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions`,
    );
    const negItem = allList.body.items.find((i) => i.questionText === question);
    expect(negItem?.source).toBe('NEGATIVE_FEEDBACK');
    expect(allList.body.items.some((i) => i.source === 'UNANSWERED')).toBe(true);

    // AC-FB5-2: 상세는 당시 봇 답변·매칭 FAQ 이름을 보여준다(삭제 전).
    const detailBefore = await jsonRequest<{ lastFeedback?: { botResponse: string; target: { kind: string; id?: string; name?: string; deleted: boolean } } }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${negItem?.id}`,
    );
    expect(detailBefore.body.lastFeedback?.target.kind).toBe('FAQ');
    expect(detailBefore.body.lastFeedback?.target.id).toBe(faqId);
    expect(detailBefore.body.lastFeedback?.target.name).toBe(question);
    expect(detailBefore.body.lastFeedback?.target.deleted).toBe(false);
    expect(detailBefore.body.lastFeedback?.botResponse).toContain('배송은 3일');

    // FAQ를 삭제한 뒤에는 같은 id를 보존한 채 "삭제됨"으로 표시된다(EX-FB-14).
    const delRes = await jsonRequest('DELETE', `${baseUrl}/chatbots/${chatbotId}/faqs/${faqId}`);
    expect(delRes.status).toBe(204);
    const detailAfter = await jsonRequest<{ lastFeedback?: { target: { id?: string; name?: string; deleted: boolean } } }>(
      'GET',
      `${baseUrl}/chatbots/${chatbotId}/unanswered-questions/${negItem?.id}`,
    );
    expect(detailAfter.body.lastFeedback?.target.id).toBe(faqId);
    expect(detailAfter.body.lastFeedback?.target.name).toBeUndefined();
    expect(detailAfter.body.lastFeedback?.target.deleted).toBe(true);
  });
});
