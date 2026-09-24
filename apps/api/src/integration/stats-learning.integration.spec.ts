import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ApiErrorSchema,
  BulkResultSchema,
  ResolveResultSchema,
  StatsDistributionSchema,
  StatsSummarySchema,
} from '@chat-bot/shared-types';
import { normalizeText } from '@chat-bot/shared-types';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loginAs, seedTestUsers } from './helpers/auth.helper';
import { createConversationLog } from './helpers/conversation-log.helper';

const API_ROOT = join(__dirname, '..', '..');

let authCookie = '';
let viewerCookie = '';

interface ApiResponse<T = unknown> {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: T;
}

function jsonRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
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
          ...(authCookie ? { Cookie: authCookie } : {}),
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

/**
 * 통계/분석(No.14~15) 통합 테스트. `docs/requirements/stats-learning.md` AC-14A/14B/15A/15B/X
 * 및 `docs/02-spec/stats-learning-설계.md` §16 추적표의 핵심 항목을 HTTP 계약 레벨에서 검증한다.
 */
describe('통계/분석(No.14~15) 통합 테스트', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let tmpDir: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chatbot-stats-learning-test-'));
    const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
    const testDatabaseUrl = `file:${dbPath}`;

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DEPLOY_SCHEDULE_ENABLED = 'false'; // [No.28] 실행 엔진 비활성 — 기존 그룹 통합 시험은 폴링 없이 수행(§7.10)
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
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.enableCors();
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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createGroup(name = '통계학습 테스트 그룹'): Promise<string> {
    const res = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbot-groups`, { name });
    return res.body.id;
  }

  async function createChatbot(): Promise<{ id: string; slug: string }> {
    const groupId = await createGroup();
    const suffix = Math.random().toString(36).slice(2, 10);
    const slug = `sl-bot-${suffix}`;
    const res = await jsonRequest<{ id: string }>('POST', `${baseUrl}/chatbots`, { groupId, name: '통계학습 테스트봇', slug });
    return { id: res.body.id, slug };
  }

  async function activateChatbot(chatbotId: string): Promise<void> {
    const res = await jsonRequest('PATCH', `${baseUrl}/chatbots/${chatbotId}/status`, { status: 'ACTIVE' });
    expect(res.status).toBe(200);
  }

  function base(chatbotId: string): string {
    return `${baseUrl}/chatbots/${chatbotId}`;
  }

  async function setupPublicChatbot(): Promise<{ chatbotId: string; slug: string }> {
    const { id: chatbotId, slug } = await createChatbot();
    await activateChatbot(chatbotId);
    const channelRes = await jsonRequest('PATCH', `${base(chatbotId)}/channels/WEB`, {
      enabled: true,
      config: { allowedOrigins: [], greetingMessage: '무엇을 도와드릴까요?' },
    });
    expect(channelRes.status).toBe(200);
    return { chatbotId, slug };
  }

  function sendPublicMessage(slug: string, sessionId: string, message: string) {
    return jsonRequest('POST', `${baseUrl}/public/chatbots/${slug}/messages`, { sessionId, message });
  }

  async function waitForFireAndForget(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  async function seedNode(chatbotId: string): Promise<{ intentId: string; nodeId: string }> {
    const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
      name: '배송조회',
      examples: ['배송 조회'],
    });
    const intentId = intentRes.body.intent.id;
    const nodeRes = await jsonRequest<{ id: string }>('POST', `${base(chatbotId)}/dialog-nodes`, {
      name: '배송조회_응답',
      intentIds: [intentId],
      outputs: [{ type: 'TEXT', payload: { text: '운송장을 확인해 드릴게요.' } }],
    });
    return { intentId, nodeId: nodeRes.body.id };
  }

  async function seedUnanswered(chatbotId: string, questionText: string): Promise<string> {
    const row = await prisma.unansweredQuestion.create({
      data: {
        chatbotId,
        questionText,
        questionNormalized: normalizeText(questionText),
        variants: JSON.stringify([questionText]),
      },
    });
    return row.id;
  }

  // ================================================================================================
  // No.14 — 기본 통계
  // ================================================================================================
  describe('No.14 기본 통계', () => {
    it('AC-14A-1: DAY 기본 조회는 30개 버킷을 반환하고 빈 구간은 0이다', async () => {
      const { id: chatbotId } = await createChatbot();
      await createConversationLog(prisma, { chatbotId, userMessage: '문의1', isAnswered: true });

      const res = await jsonRequest(`GET`, `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY`);
      expect(res.status).toBe(200);
      const parsed = StatsSummarySchema.parse(res.body);
      expect(parsed.buckets).toHaveLength(30);
      expect(parsed.totals.turnCount).toBe(1);
    });

    it('AC-14A-2: 일별 합계(turnCount/answeredCount/unansweredCount/blockedCount)가 주별 합계와 정확히 일치한다', async () => {
      const { id: chatbotId } = await createChatbot();
      // EX-14-6(미래 날짜는 오늘까지로 보정)에 걸리지 않도록 실제 "지금" 기준 과거로 10일치를 심는다.
      const base0 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const fromParam = new Date(base0.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const toParam = new Date(Date.now()).toISOString().slice(0, 10);
      for (let i = 0; i < 10; i += 1) {
        await createConversationLog(prisma, {
          chatbotId,
          userMessage: `합계질문${i}`,
          isAnswered: i % 3 !== 0,
          blockedByFilter: i === 5,
          createdAt: new Date(base0.getTime() + i * 24 * 60 * 60 * 1000),
        });
      }

      const dayRes = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY&from=${fromParam}&to=${toParam}`,
      );
      const weekRes = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=WEEK&from=${fromParam}&to=${toParam}`,
      );
      const daySum = StatsSummarySchema.parse(dayRes.body).totals;
      const weekSum = StatsSummarySchema.parse(weekRes.body).totals;

      expect(weekSum.turnCount).toBe(daySum.turnCount);
      expect(weekSum.answeredCount).toBe(daySum.answeredCount);
      expect(weekSum.unansweredCount).toBe(daySum.unansweredCount);
      expect(weekSum.blockedCount).toBe(daySum.blockedCount);
      expect(daySum.turnCount).toBe(10);
    });

    it('AC-14A-3: MONTH 단위 합계가 DAY 합계 총합과 일치한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const base0 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const fromParam = new Date(base0.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const toParam = new Date(Date.now()).toISOString().slice(0, 10);
      for (let i = 0; i < 10; i += 1) {
        await createConversationLog(prisma, {
          chatbotId,
          userMessage: `월합계질문${i}`,
          isAnswered: i % 3 !== 0,
          blockedByFilter: i === 5,
          createdAt: new Date(base0.getTime() + i * 24 * 60 * 60 * 1000),
        });
      }
      const dayRes = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY&from=${fromParam}&to=${toParam}`,
      );
      const monthRes = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=MONTH&from=${fromParam}&to=${toParam}`,
      );
      const daySum = StatsSummarySchema.parse(dayRes.body).totals;
      const monthSum = StatsSummarySchema.parse(monthRes.body).totals;
      expect(monthSum.turnCount).toBe(daySum.turnCount);
      expect(monthSum.answeredCount).toBe(daySum.answeredCount);
      expect(monthSum.unansweredCount).toBe(daySum.unansweredCount);
      expect(monthSum.blockedCount).toBe(daySum.blockedCount);
      expect(daySum.turnCount).toBe(10);
    });

    it('AC-14A-4: KST 자정 경계(23:50/00:10)에 적재된 로그가 서로 다른 일 버킷으로 집계된다', async () => {
      const { id: chatbotId } = await createChatbot();
      // KST 2026-01-14 23:50 = UTC 2026-01-14 14:50 / KST 2026-01-15 00:10 = UTC 2026-01-14 15:10
      await createConversationLog(prisma, { chatbotId, userMessage: '자정전질문', isAnswered: true, createdAt: new Date('2026-01-14T14:50:00.000Z') });
      await createConversationLog(prisma, { chatbotId, userMessage: '자정후질문', isAnswered: true, createdAt: new Date('2026-01-14T15:10:00.000Z') });

      const res = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY&from=2026-01-14&to=2026-01-15`,
      );
      const parsed = StatsSummarySchema.parse(res.body);
      const byKey = Object.fromEntries(parsed.buckets.map((b) => [b.key, b.turnCount]));
      expect(byKey['2026-01-14']).toBe(1);
      expect(byKey['2026-01-15']).toBe(1);
    });

    it('AC-14A-5: WEEK 버킷은 월요일 시작이며 라벨에 시작·종료일이 함께 표기된다', async () => {
      const { id: chatbotId } = await createChatbot();
      // 2026-09-21(월)~09-27(일)은 ISO 주차 W39다.
      await createConversationLog(prisma, { chatbotId, userMessage: '주간라벨질문', isAnswered: true, createdAt: new Date('2026-09-23T03:00:00.000Z') });
      const res = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=WEEK&from=2026-09-21&to=2026-09-27`,
      );
      const parsed = StatsSummarySchema.parse(res.body);
      expect(parsed.buckets).toHaveLength(1);
      expect(parsed.buckets[0].key).toBe('2026-W39');
      expect(parsed.buckets[0].label).toBe('2026-W39(09/21~09/27)');
    });

    it('AC-14A-8: 기간 미지정 시 단위별 기본 기간(일30/주12/월12)이 적용된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const day = StatsSummarySchema.parse((await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY`)).body);
      const week = StatsSummarySchema.parse((await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=WEEK`)).body);
      const month = StatsSummarySchema.parse((await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=MONTH`)).body);
      expect(day.buckets).toHaveLength(30);
      expect(week.buckets).toHaveLength(12);
      expect(month.buckets).toHaveLength(12);
      // 세 granularity 모두 서버가 계산한 periodStart < periodEnd를 응답에 포함해 화면이 "무엇을 보는지" 표시할 수 있다(FR-14-12).
      expect(new Date(day.periodStart).getTime()).toBeLessThan(new Date(day.periodEnd).getTime());
      expect(new Date(week.periodStart).getTime()).toBeLessThan(new Date(week.periodEnd).getTime());
      expect(new Date(month.periodStart).getTime()).toBeLessThan(new Date(month.periodEnd).getTime());
    });

    it('AC-14A-6: DAY 단위 120일 조회는 400 STATS_RANGE_TOO_WIDE다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest(
        'GET',
        `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY&from=2026-01-01&to=2026-06-01`,
      );
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('STATS_RANGE_TOO_WIDE');
    });

    it('AC-14A-7: 지원하지 않는 단위는 400 INVALID_GRANULARITY다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=YEAR`);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('INVALID_GRANULARITY');
    });

    it('AC-14A-11: 존재하지 않는 chatbotId는 404다', async () => {
      const res = await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it('AC-14A-9: 동일 기간 dashboard와 summary의 접속수·응답률·총 건수가 일치한다', async () => {
      const { id: chatbotId } = await createChatbot();
      for (let i = 0; i < 5; i += 1) {
        await createConversationLog(prisma, {
          chatbotId,
          userMessage: `dq${i}`,
          isAnswered: i % 2 === 0,
          sessionId: `sess-${i % 2}`,
        });
      }
      const dashboardRes = await jsonRequest<{ visitCount: number; responseRate: number; totalLogCount: number }>(
        'GET',
        `${baseUrl}/stats/dashboard?chatbotId=${chatbotId}`,
      );
      const summaryRes = await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY`);
      const summary = StatsSummarySchema.parse(summaryRes.body);

      expect(summary.totals.sessionCount).toBe(dashboardRes.body.visitCount);
      expect(summary.totals.responseRate).toBe(dashboardRes.body.responseRate);
      expect(summary.totals.turnCount).toBe(dashboardRes.body.totalLogCount);
    });

    it('AC-14A-10: 로그 0건 챗봇은 200이며 전부 0이다(오류 아님)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}&granularity=DAY`);
      expect(res.status).toBe(200);
      const parsed = StatsSummarySchema.parse(res.body);
      expect(parsed.totals.turnCount).toBe(0);
    });

    it('AC-14B-2/AC-14B-5: 응답 출처 분포가 폴백을 최우선 판정하고 byHour/byWeekday는 각각 24/7개다', async () => {
      const { id: chatbotId } = await createChatbot();
      await createConversationLog(prisma, { chatbotId, userMessage: 'n1', isAnswered: true, matchedNodeId: 'node-x' });
      await createConversationLog(prisma, { chatbotId, userMessage: 'f1', isAnswered: true, matchedFaqId: 'faq-x' });
      // isAnswered=false인데 matchedNodeId가 채워진 폴백 노드 케이스도 FALLBACK으로 집계돼야 한다(§7.3).
      await createConversationLog(prisma, { chatbotId, userMessage: 'u1', isAnswered: false, matchedNodeId: 'fallback-node' });

      const res = await jsonRequest('GET', `${baseUrl}/stats/distribution?chatbotId=${chatbotId}`);
      expect(res.status).toBe(200);
      const parsed = StatsDistributionSchema.parse(res.body);
      const bySource = Object.fromEntries(parsed.bySource.map((s) => [s.source, s.count]));
      expect(bySource.NODE).toBe(1);
      expect(bySource.FAQ).toBe(1);
      expect(bySource.FALLBACK).toBe(1);
      expect(parsed.byHour).toHaveLength(24);
      expect(parsed.byWeekday).toHaveLength(7);
    });

    it('EX-14-10/C-1: ARCHIVED 챗봇의 통계 조회는 200으로 허용된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const archiveRes = await jsonRequest('DELETE', `${base(chatbotId)}`);
      expect(archiveRes.status).toBe(204);
      const res = await jsonRequest('GET', `${baseUrl}/stats/summary?chatbotId=${chatbotId}`);
      expect(res.status).toBe(200);
    });
  });

  // ================================================================================================
  // No.14 — dayBucket/hourBucket 버킷 적재·백필 검증(DD-50/59/64)
  // ================================================================================================
  describe('No.14 dayBucket/hourBucket 버킷 적재·백필', () => {
    it('공개 대화 API로 적재된 로그는 record() 시점에 dayBucket/hourBucket이 즉시 채워진다(센티넬 아님)', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      await sendPublicMessage(slug, randomUUID(), '버킷적재확인질문');
      await waitForFireAndForget();
      const row = await prisma.conversationLog.findFirst({ where: { chatbotId }, orderBy: { createdAt: 'desc' } });
      expect(row?.dayBucket).not.toBe('');
      expect(row?.hourBucket ?? -1).toBeGreaterThanOrEqual(0);
      expect(row?.hourBucket ?? -1).toBeLessThanOrEqual(23);
    });

    it(
      '백필 스크립트: 센티넬(dayBucket=""/hourBucket=-1) 행을 KST 버킷으로 채우고 검증 쿼리를 통과시킨다',
      async () => {
        const { id: chatbotId } = await createChatbot();
        // 구버전 로그(마이그레이션 전 상태, DD-64 §3.3)를 재현하기 위해 서비스를 거치지 않고 직접 INSERT한다.
        const createdAt = new Date('2026-01-15T03:00:00.000Z'); // KST 2026-01-15 12:00
        await prisma.conversationLog.create({
          data: {
            chatbotId,
            channelType: 'WEB',
            userMessage: '백필대상질문',
            botResponse: '안내해 드리겠습니다.',
            isAnswered: true,
            createdAt,
          },
        });
        const before = await prisma.conversationLog.findFirst({ where: { chatbotId } });
        expect(before?.dayBucket).toBe('');
        expect(before?.hourBucket).toBe(-1);

        execSync('pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/backfill-conversation-buckets.ts', {
          cwd: API_ROOT,
          env: { ...process.env },
          stdio: 'pipe',
        });

        const after = await prisma.conversationLog.findFirst({ where: { chatbotId } });
        expect(after?.dayBucket).toBe('2026-01-15');
        expect(after?.hourBucket).toBe(12);
      },
      30_000,
    );
  });

  // ================================================================================================
  // No.15 — 미응답 질문 수집(ADR-0019)
  // ================================================================================================
  describe('No.15 미응답 질문 수집', () => {
    it('AC-15A-1/2: 표기만 다른 미응답 발화가 반복되면 1행으로 병합되고 occurredCount가 증가한다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const sessionId = randomUUID();
      await sendPublicMessage(slug, sessionId, '해외배송 되나요');
      await sendPublicMessage(slug, sessionId, ' 해외배송  되나요 ');
      await sendPublicMessage(slug, sessionId, '해외배송 되나요');
      await waitForFireAndForget();

      const res = await jsonRequest<{ items: Array<{ occurredCount: number; questionText: string }> }>(
        'GET',
        `${base(chatbotId)}/unanswered-questions`,
      );
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].occurredCount).toBe(3);
    });

    it('AC-15A-3: 금지어로 차단된 발화는 큐에 적재되지 않는다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const word = `금지어${Math.random().toString(36).slice(2, 8)}`;
      // 실제 HTTP 경로로 등록해야 `BannedWordFilterService`의 캐시가 즉시 무효화된다(AC-12D-8).
      // 직접 `prisma.bannedWord.create`만 하면 60초 캐시 TTL 동안 필터가 새 단어를 인식하지 못한다.
      const createRes = await jsonRequest('POST', `${baseUrl}/banned-words`, {
        word,
        matchType: 'CONTAINS',
        policy: 'BLOCK',
      });
      expect(createRes.status).toBe(201);

      await sendPublicMessage(slug, randomUUID(), `${word} 문의드립니다`);
      await waitForFireAndForget();

      const res = await jsonRequest<{ items: unknown[] }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(res.body.items).toHaveLength(0);
    });

    it('AC-15A-5: 빈 문자열/공백만 입력은 적재되지 않는다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      await sendPublicMessage(slug, randomUUID(), '   ');
      await waitForFireAndForget();
      const res = await jsonRequest<{ items: unknown[] }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(res.body.items).toHaveLength(0);
    });

    it('AC-15A-6: 시뮬레이션은 ConversationLog를 남기지 않으므로 큐에도 적재되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      for (let i = 0; i < 5; i += 1) {
        await jsonRequest('POST', `${base(chatbotId)}/simulate`, { message: `전혀 모르는 질문 ${i}` });
      }
      await waitForFireAndForget();
      const res = await jsonRequest<{ items: unknown[] }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(res.body.items).toHaveLength(0);
    });

    it('AC-15A-7: 정상 응답된 발화는 큐에 적재되지 않는다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      await seedNode(chatbotId);
      await sendPublicMessage(slug, randomUUID(), '배송 조회');
      await waitForFireAndForget();
      const res = await jsonRequest<{ items: unknown[] }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(res.body.items).toHaveLength(0);
    });

    it('AC-15A-9: 큐에 저장된 문장은 PII가 마스킹된 값이다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      await sendPublicMessage(slug, randomUUID(), '010-1234-5678 로 연락 주세요');
      await waitForFireAndForget();
      const res = await jsonRequest<{ items: Array<{ questionText: string }> }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].questionText).not.toContain('010-1234-5678');
    });
  });

  // ================================================================================================
  // No.15 — 검토·반영·무시·재오픈(DD-55/62/63, ADR-0018)
  // ================================================================================================
  describe('No.15 검토·반영', () => {
    it('AC-15B-4/5: 기존 의도로 반영하면 예문이 추가되고 캐시 TTL을 기다리지 않고 즉시 매칭된다', async () => {
      const { chatbotId, slug } = await setupPublicChatbot();
      const { intentId } = await seedNode(chatbotId);
      const unansweredId = await seedUnanswered(chatbotId, '언제 배송되나요');

      const res = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${unansweredId}/resolve`, { intentId });
      expect(res.status).toBe(200);
      const parsed = ResolveResultSchema.parse(res.body);
      expect(parsed.created).toBe(false);
      expect(parsed.linkedNodeCount).toBe(1);
      expect(parsed.appliedImmediately).toBe(true);

      const msgRes = await sendPublicMessage(slug, randomUUID(), '언제 배송되나요');
      expect((msgRes.body as { outputs: Array<{ payload: { text: string } }> }).outputs[0].payload.text).toBe('운송장을 확인해 드릴게요.');
    });

    it('AC-15B-6/7: 새 의도명은 생성하고, 대소문자·공백만 다른 이름은 기존 의도에 병합한다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id1 = await seedUnanswered(chatbotId, '포장 선물 되나요');
      const created = await jsonRequest(
        'POST',
        `${base(chatbotId)}/unanswered-questions/${id1}/resolve`,
        { intentName: '선물포장문의' },
      );
      expect(ResolveResultSchema.parse(created.body).created).toBe(true);

      const id2 = await seedUnanswered(chatbotId, '선물 포장도 가능한가요');
      const merged = await jsonRequest(
        'POST',
        `${base(chatbotId)}/unanswered-questions/${id2}/resolve`,
        { intentName: ' 선물포장문의 ' },
      );
      const mergedResult = ResolveResultSchema.parse(merged.body);
      expect(mergedResult.created).toBe(false);
      expect(mergedResult.intentId).toBe(ResolveResultSchema.parse(created.body).intentId);
    });

    it('AC-15B-8: 노드가 연결되지 않은 의도로 반영하면 linkedNodeCount:0이다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '포장 선물 되나요');
      const res = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '노드없는의도' });
      expect(ResolveResultSchema.parse(res.body).linkedNodeCount).toBe(0);
    });

    it('AC-15B-9: 예문이 이미 상한(500)인 의도로 반영하면 400 LIMIT_EXCEEDED이고 상태는 PENDING 그대로다', async () => {
      const { id: chatbotId } = await createChatbot();
      const examples = Array.from({ length: 500 }, (_, i) => `예문${i}`);
      const intentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, { name: '상한의도', examples });
      const intentId = intentRes.body.intent.id;
      const id = await seedUnanswered(chatbotId, '상한테스트질문');

      const res = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentId });
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).code).toBe('LIMIT_EXCEEDED');

      const detail = await jsonRequest<{ status: string }>('GET', `${base(chatbotId)}/unanswered-questions/${id}`);
      expect(detail.body.status).toBe('PENDING');
    });

    it('AC-15B-10: 이미 RESOLVED된 항목을 다시 반영하면 409 ALREADY_RESOLVED다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '재반영테스트질문');
      const first = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '의도A' });
      expect(first.status).toBe(200);
      const second = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '의도B' });
      expect(second.status).toBe(409);
      expect(ApiErrorSchema.parse(second.body).code).toBe('ALREADY_RESOLVED');
    });

    it('AC-15B-11: 두 관리자의 동시 반영 요청 중 한쪽만 성공하고 예문이 중복 추가되지 않는다(DD-63)', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '동시반영테스트질문');

      const [first, second] = await Promise.all([
        jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '동시반영의도' }),
        jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '동시반영의도' }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const winner = first.status === 200 ? first : second;
      const { intentId } = ResolveResultSchema.parse(winner.body);
      const intentDetail = await jsonRequest<{ examples: string[] }>('GET', `${base(chatbotId)}/intents/${intentId}`);
      // 두 요청이 같은 문장을 예문으로 넣으려 해도 dedupe + CAS 상태전이로 예문은 1건만 남는다(DD-63).
      expect(intentDetail.body.examples.filter((e) => e === '동시반영테스트질문')).toHaveLength(1);
    });

    it('AC-15B-12/13: bulk-resolve는 부분 성공을 허용하고 상한 초과는 400 BULK_SIZE_EXCEEDED다', async () => {
      const { id: chatbotId } = await createChatbot();
      const overLimitExamples = Array.from({ length: 500 }, (_, i) => `상한예문${i}`);
      const fullIntentRes = await jsonRequest<{ intent: { id: string } }>('POST', `${base(chatbotId)}/intents`, {
        name: '풀의도',
        examples: overLimitExamples,
      });
      const fullIntentId = fullIntentRes.body.intent.id;

      const okIds: string[] = [];
      for (let i = 0; i < 7; i += 1) okIds.push(await seedUnanswered(chatbotId, `벌크질문${i}`));
      const overflowId = await seedUnanswered(chatbotId, '벌크상한질문');

      const bulkRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/bulk-resolve`, {
        items: [...okIds.map((id) => ({ id, intentName: '벌크의도' })), { id: overflowId, intentId: fullIntentId }],
      });
      expect(bulkRes.status).toBe(200);
      const parsed = BulkResultSchema.parse(bulkRes.body);
      expect(parsed.succeeded).toBe(7);
      expect(parsed.failed).toHaveLength(1);
      expect(parsed.failed[0].code).toBe('LIMIT_EXCEEDED');

      const tooMany = Array.from({ length: 51 }, () => ({ id: overflowId, intentName: 'x' }));
      const overRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/bulk-resolve`, { items: tooMany });
      expect(overRes.status).toBe(400);
      expect(ApiErrorSchema.parse(overRes.body).code).toBe('BULK_SIZE_EXCEEDED');
    });

    it('AC-15B-12 보강/NFR-S8: bulk-resolve 성공 건마다 Intent 감사 1건씩 "학습현황 일괄 반영" summary로 남고 질문 원문은 없다', async () => {
      const { id: chatbotId } = await createChatbot();
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) ids.push(await seedUnanswered(chatbotId, `벌크감사질문${i}`));

      const before = await jsonRequest<{ total: number }>('GET', `${baseUrl}/audit-logs?chatbotId=${chatbotId}&targetType=Intent`);
      const bulkRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/bulk-resolve`, {
        items: ids.map((id) => ({ id, intentName: '벌크감사의도' })),
      });
      expect(bulkRes.status).toBe(200);
      expect(BulkResultSchema.parse(bulkRes.body).succeeded).toBe(3);

      const after = await jsonRequest<{ total: number; items: Array<{ summary: string | null }> }>(
        'GET',
        `${baseUrl}/audit-logs?chatbotId=${chatbotId}&targetType=Intent`,
      );
      // 1건은 의도 생성(CREATE), 나머지 2건은 예문 병합(UPDATE)이라 성공 건수(3)만큼 감사 레코드가 늘어난다(§11.2).
      expect(after.body.total - before.body.total).toBe(3);
      expect(after.body.items.every((i) => (i.summary ?? '').includes('학습현황 일괄 반영'))).toBe(true);
      expect(JSON.stringify(after.body)).not.toContain('벌크감사질문');
    });

    it('AC-15B-14: ignore한 항목은 기본 목록에서 제외되고 status=IGNORED로는 조회된다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '무시할질문');
      const ignoreRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/ignore`, {});
      expect(ignoreRes.status).toBe(200);

      const defaultList = await jsonRequest<{ items: Array<{ id: string }> }>('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(defaultList.body.items.some((i) => i.id === id)).toBe(false);

      const ignoredList = await jsonRequest<{ items: Array<{ id: string }> }>(
        'GET',
        `${base(chatbotId)}/unanswered-questions?status=IGNORED`,
      );
      expect(ignoredList.body.items.some((i) => i.id === id)).toBe(true);
    });

    it('AC-15B-15: RESOLVED 항목을 reopen하면 예문은 남고 상태만 PENDING으로 돌아간다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '재오픈질문');
      const resolveRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '재오픈의도' });
      const { intentId } = ResolveResultSchema.parse(resolveRes.body);

      const reopenRes = await jsonRequest<{ status: string }>('POST', `${base(chatbotId)}/unanswered-questions/${id}/reopen`, {});
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.status).toBe('PENDING');

      const intentDetail = await jsonRequest<{ examples: string[] }>('GET', `${base(chatbotId)}/intents/${intentId}`);
      expect(intentDetail.body.examples.length).toBeGreaterThan(0);
    });

    it('AC-15B-16: 미응답 질문의 물리 삭제 경로는 존재하지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '삭제불가질문');
      const res = await jsonRequest('DELETE', `${base(chatbotId)}/unanswered-questions/${id}`);
      expect(res.status).toBe(404);
    });

    it('AC-15B-17/19: resolve는 Intent 감사 1건을 남기고 미응답 질문 문자열을 포함하지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const secretQuestion = '감사로그질문 010-9999-8888';
      const id = await seedUnanswered(chatbotId, secretQuestion);
      await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: '감사확인의도' });

      const auditRes = await jsonRequest<{ items: Array<{ summary: string | null }> }>(
        'GET',
        `${baseUrl}/audit-logs?chatbotId=${chatbotId}&targetType=Intent`,
      );
      expect(auditRes.body.items.length).toBeGreaterThan(0);
      expect(auditRes.body.items[0].summary ?? '').toContain('학습현황');
      expect(JSON.stringify(auditRes.body)).not.toContain('감사로그질문');
    });

    it('AC-15B-18: ignore/reopen은 감사 기록을 남기지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '무시감사질문');
      const before = await jsonRequest<{ total: number }>('GET', `${baseUrl}/audit-logs?chatbotId=${chatbotId}`);
      await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/ignore`, {});
      await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/reopen`, {});
      const after = await jsonRequest<{ total: number }>('GET', `${baseUrl}/audit-logs?chatbotId=${chatbotId}`);
      expect(after.body.total).toBe(before.body.total);
    });

    it('C-1: 보관된 챗봇은 조회는 허용되고 반영은 409 CHATBOT_ARCHIVED다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, '보관챗봇질문');
      const archiveRes = await jsonRequest('DELETE', `${base(chatbotId)}`);
      expect(archiveRes.status).toBe(204);

      const listRes = await jsonRequest('GET', `${base(chatbotId)}/unanswered-questions`);
      expect(listRes.status).toBe(200);

      const resolveRes = await jsonRequest('POST', `${base(chatbotId)}/unanswered-questions/${id}/resolve`, { intentName: 'x' });
      expect(resolveRes.status).toBe(409);
      expect(ApiErrorSchema.parse(resolveRes.body).code).toBe('CHATBOT_ARCHIVED');
    });

    it('라우트 순서: GET .../summary는 :id 라우트에 삼켜지지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest<{ pendingCount: number }>('GET', `${base(chatbotId)}/unanswered-questions/summary`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pendingCount');
    });

    it('AC-UI-5/6: VIEWER는 반영 API 호출 시 403이고 DB가 변경되지 않는다', async () => {
      const { id: chatbotId } = await createChatbot();
      const id = await seedUnanswered(chatbotId, 'viewer권한테스트질문');
      const res = await jsonRequest(
        'POST',
        `${base(chatbotId)}/unanswered-questions/${id}/resolve`,
        { intentName: 'x' },
        { Cookie: viewerCookie },
      );
      expect(res.status).toBe(403);
      const row = await prisma.unansweredQuestion.findUnique({ where: { id } });
      expect(row?.status).toBe('PENDING');
    });

    it('VIEWER는 학습현황 목록을 조회할 수 있다(dialogue:read)', async () => {
      const { id: chatbotId } = await createChatbot();
      const res = await jsonRequest('GET', `${base(chatbotId)}/unanswered-questions`, undefined, { Cookie: viewerCookie });
      expect(res.status).toBe(200);
    });
  });
});
