import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { StatsDistribution, StatsQuestions, StatsSummary } from '@chat-bot/shared-types';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { StatsOverviewPage } from './StatsOverviewPage';

expect.extend(toHaveNoViolations);

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockGetSummary = vi.fn();
const mockGetDistribution = vi.fn();
const mockGetQuestions = vi.fn();
const mockGetIntentStats = vi.fn();
vi.mock('../../api/stats', () => ({
  statsApi: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args),
    getDistribution: (...args: unknown[]) => mockGetDistribution(...args),
    getQuestions: (...args: unknown[]) => mockGetQuestions(...args),
    getIntentStats: (...args: unknown[]) => mockGetIntentStats(...args),
  },
}));

function makeIntentStats(overrides: Partial<import('@chat-bot/shared-types').IntentStats> = {}): import('@chat-bot/shared-types').IntentStats {
  return {
    periodStart: PERIOD_META.periodStart,
    periodEnd: PERIOD_META.periodEnd,
    granularity: 'DAY',
    timezone: 'Asia/Seoul',
    chatbotId: chatbot.id,
    generatedAt: new Date('2026-09-22T00:00:00.000Z'),
    totalTurnCount: 100,
    matchedTurnCount: 80,
    unmatchedTurnCount: 20,
    othersTurnCount: 0,
    distinctIntentCount: 2,
    items: [
      { intentId: '44444444-4444-4444-8444-444444444444', name: '환급일_문의', deleted: false, turnCount: 50, answeredCount: 47, responseRate: 0.94, shareOfAll: 0.5, shareOfIntentMatched: 0.625 },
      { intentId: '55555555-5555-4555-8555-555555555555', name: null, deleted: true, turnCount: 30, answeredCount: 15, responseRate: 0.5, shareOfAll: 0.3, shareOfIntentMatched: 0.375 },
    ],
    ...overrides,
  };
}

const PERIOD_META = {
  periodStart: new Date('2026-08-24T00:00:00.000Z'),
  periodEnd: new Date('2026-09-22T23:59:59.999Z'),
  granularity: 'DAY' as const,
  timezone: 'Asia/Seoul' as const,
};

function makeSummary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    ...PERIOD_META,
    totals: {
      turnCount: 100,
      answeredCount: 88,
      unansweredCount: 12,
      blockedCount: 4,
      responseRate: 0.88,
      noResponseRate: 0.12,
      sessionCount: 40,
      visitCountBasis: 'SESSION',
      turnsPerSession: 2.5,
    },
    buckets: [
      { key: '2026-09-21', label: '09-21', start: new Date('2026-09-21'), end: new Date('2026-09-21'), turnCount: 50, answeredCount: 44, unansweredCount: 6, blockedCount: 2, responseRate: 0.88, sessionCount: 20 },
      { key: '2026-09-22', label: '09-22', start: new Date('2026-09-22'), end: new Date('2026-09-22'), turnCount: 50, answeredCount: 44, unansweredCount: 6, blockedCount: 2, responseRate: 0.88, sessionCount: 20 },
    ],
    ...overrides,
  };
}

function makeDistribution(overrides: Partial<StatsDistribution> = {}): StatsDistribution {
  return {
    ...PERIOD_META,
    bySource: [
      { source: 'NODE', count: 62, ratio: 0.62 },
      { source: 'FAQ', count: 25, ratio: 0.25 },
      { source: 'OTHER', count: 0, ratio: 0 },
      { source: 'FALLBACK', count: 13, ratio: 0.13 },
    ],
    byChannel: [{ channelType: 'WEB', sessionCount: 40, ratio: 1 }],
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, turnCount: hour === 10 ? 20 : 1 })),
    byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, turnCount: weekday === 1 ? 30 : 5, responseRate: 0.8 })),
    ...overrides,
  };
}

function makeQuestions(overrides: Partial<StatsQuestions> = {}): StatsQuestions {
  return {
    ...PERIOD_META,
    topQuestions: [{ question: '배송 언제 오나요', count: 30 }],
    topUnansweredQuestions: [{ question: '해외배송도 되나요', count: 12, unansweredQuestionId: '99999999-9999-4999-8999-999999999999' }],
    approximated: false,
    candidateLimit: 500,
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <StatsOverviewPage />
    </MemoryRouter>,
  );
}

/** S1 기본 통계 axe 접근성 스캔(NFR-A9, AC-UI-10). */
describe('StatsOverviewPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockGetSummary.mockReset();
    mockGetDistribution.mockReset();
    mockGetQuestions.mockReset();
    mockGetIntentStats.mockReset();
  });

  it('정상 데이터 화면(카드+차트+분포+순위+의도별 매칭)에 구조적 접근성 위반이 없다', async () => {
    mockGetSummary.mockResolvedValue(makeSummary());
    mockGetDistribution.mockResolvedValue(makeDistribution());
    mockGetQuestions.mockResolvedValue(makeQuestions());
    mockGetIntentStats.mockResolvedValue(makeIntentStats());

    const { container } = renderPage();
    await screen.findByText('세션 수');
    await screen.findByText('응답 출처 분포');
    await screen.findByRole('heading', { name: '의도별 매칭' });
    await screen.findByText('환급일_문의');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('기간 내 대화 0건(빈 상태)에도 접근성 위반이 없다(AC-14A-10)', async () => {
    mockGetSummary.mockResolvedValue(
      makeSummary({
        totals: {
          turnCount: 0,
          answeredCount: 0,
          unansweredCount: 0,
          blockedCount: 0,
          responseRate: 0,
          noResponseRate: 0,
          sessionCount: 0,
          visitCountBasis: 'LOG_COUNT',
          turnsPerSession: 0,
        },
        buckets: [],
      }),
    );
    mockGetDistribution.mockResolvedValue(
      makeDistribution({
        bySource: [
          { source: 'NODE', count: 0, ratio: 0 },
          { source: 'FAQ', count: 0, ratio: 0 },
          { source: 'OTHER', count: 0, ratio: 0 },
          { source: 'FALLBACK', count: 0, ratio: 0 },
        ],
        byChannel: [],
        byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, turnCount: 0 })),
        byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, turnCount: 0, responseRate: 0 })),
      }),
    );
    mockGetQuestions.mockResolvedValue(makeQuestions({ topQuestions: [], topUnansweredQuestions: [] }));
    mockGetIntentStats.mockResolvedValue(makeIntentStats({ matchedTurnCount: 0, items: [], distinctIntentCount: 0, unmatchedTurnCount: 100 }));

    const { container } = renderPage();
    await screen.findByText('선택한 기간에 대화 기록이 없습니다.');
    await screen.findByText('매칭된 의도가 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
