import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { StatsDistribution, StatsQuestions, StatsSummary } from '@chat-bot/shared-types';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { StatsOverviewPage } from './StatsOverviewPage';

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
    buckets: [],
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
    topUnansweredQuestions: [],
    approximated: false,
    candidateLimit: 500,
    ...overrides,
  };
}

function mockAllSuccess(): void {
  mockGetSummary.mockResolvedValue(makeSummary());
  mockGetDistribution.mockResolvedValue(makeDistribution());
  mockGetQuestions.mockResolvedValue(makeQuestions());
  mockGetIntentStats.mockResolvedValue({
    periodStart: PERIOD_META.periodStart,
    periodEnd: PERIOD_META.periodEnd,
    granularity: 'DAY',
    timezone: 'Asia/Seoul',
    chatbotId: chatbot.id,
    generatedAt: new Date('2026-09-22T00:00:00.000Z'),
    totalTurnCount: 0,
    matchedTurnCount: 0,
    unmatchedTurnCount: 0,
    othersTurnCount: 0,
    distinctIntentCount: 0,
    items: [],
  });
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <StatsOverviewPage />
    </MemoryRouter>,
  );
}

describe('StatsOverviewPage — 요청 순번 가드', () => {
  beforeEach(() => {
    mockGetSummary.mockReset();
    mockGetDistribution.mockReset();
    mockGetQuestions.mockReset();
    mockGetIntentStats.mockReset();
  });

  it('빠른 기간(세분화) 전환 시 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    mockAllSuccess();
    let resolveStaleDay: (value: StatsSummary) => void = () => undefined;
    const staleDayPromise = new Promise<StatsSummary>((resolve) => {
      resolveStaleDay = resolve;
    });
    mockGetSummary
      .mockImplementationOnce(() => staleDayPromise) // 1차 호출(granularity=DAY) — 응답이 늦게 온다.
      .mockImplementationOnce(() => Promise.resolve(makeSummary({ totals: { ...makeSummary().totals, sessionCount: 77 } }))); // 2차(WEEK) — 먼저 도착.

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('radio', { name: '일' });

    await user.click(screen.getByRole('radio', { name: '주' }));

    // 2차(WEEK) 응답이 먼저 반영된다.
    expect(await screen.findByText('77')).toBeInTheDocument();

    // 뒤늦게 도착한 1차(DAY) 응답은 무시되어야 한다.
    resolveStaleDay(makeSummary({ totals: { ...makeSummary().totals, sessionCount: 999 } }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('77')).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('재시도 버튼 경로도 순번 가드를 거친다(늦게 도착한 이전 재시도 응답이 최신 요청 결과를 덮어쓰지 않는다)', async () => {
    mockAllSuccess();
    mockGetSummary.mockRejectedValueOnce(new Error('네트워크 오류'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('통계를 불러오지 못했습니다.');

    let resolveStaleRetry: (value: StatsSummary) => void = () => undefined;
    const staleRetryPromise = new Promise<StatsSummary>((resolve) => {
      resolveStaleRetry = resolve;
    });
    mockGetSummary
      .mockImplementationOnce(() => staleRetryPromise) // 재시도 클릭(1차) — 응답이 늦게 온다.
      .mockImplementationOnce(() => Promise.resolve(makeSummary({ totals: { ...makeSummary().totals, sessionCount: 55 } }))); // 곧이어 세분화 전환(2차) — 먼저 도착.

    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await user.click(screen.getByRole('radio', { name: '월' }));

    expect(await screen.findByText('55')).toBeInTheDocument();

    resolveStaleRetry(makeSummary({ totals: { ...makeSummary().totals, sessionCount: 999 } }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });
});
