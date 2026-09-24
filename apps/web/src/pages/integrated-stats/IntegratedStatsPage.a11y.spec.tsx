import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { IntegratedBreakdown, IntegratedDistribution, IntegratedGroupOptions, IntegratedOverview, IntegratedQuestions, IntegratedSummary } from '@chat-bot/shared-types';
import { IntegratedStatsPage } from './IntegratedStatsPage';

expect.extend(toHaveNoViolations);

const mockGetOverview = vi.fn();
const mockGetSummary = vi.fn();
const mockGetDistribution = vi.fn();
const mockGetBreakdown = vi.fn();
const mockGetQuestions = vi.fn();
const mockGetGroupOptions = vi.fn();

vi.mock('../../api/integratedStats', () => ({
  integratedStatsApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getSummary: (...args: unknown[]) => mockGetSummary(...args),
    getDistribution: (...args: unknown[]) => mockGetDistribution(...args),
    getBreakdown: (...args: unknown[]) => mockGetBreakdown(...args),
    getQuestions: (...args: unknown[]) => mockGetQuestions(...args),
    getGroupOptions: (...args: unknown[]) => mockGetGroupOptions(...args),
  },
}));

const PERIOD_META = {
  periodStart: new Date('2026-08-24T00:00:00.000Z'),
  periodEnd: new Date('2026-09-22T23:59:59.999Z'),
  granularity: 'DAY' as const,
  timezone: 'Asia/Seoul' as const,
};
const SCOPE_META_ALL = {
  scope: 'ALL' as const,
  groupId: null,
  backfillPending: false,
  generatedAt: new Date('2026-09-24T00:00:00.000Z'),
  timezone: 'Asia/Seoul' as const,
};

function makeOverview(overrides: Partial<IntegratedOverview> = {}): IntegratedOverview {
  return {
    ...SCOPE_META_ALL,
    group: null,
    totals: {
      turnCount: 1000,
      answeredCount: 900,
      unansweredCount: 100,
      blockedCount: 0,
      responseRate: 0.9,
      noResponseRate: 0.1,
      sessionCount: 300,
      visitCountBasis: 'SESSION',
      turnsPerSession: 3.3,
    },
    firstDayBucket: '2024-03-02',
    chatbotCounts: { active: 12, draft: 3, archived: 2 },
    ...overrides,
  };
}

function makeSummary(overrides: Partial<IntegratedSummary> = {}): IntegratedSummary {
  return {
    ...PERIOD_META,
    ...SCOPE_META_ALL,
    totals: {
      turnCount: 1000,
      answeredCount: 900,
      unansweredCount: 100,
      blockedCount: 0,
      responseRate: 0.9,
      noResponseRate: 0.1,
      sessionCount: 300,
      visitCountBasis: 'SESSION',
      turnsPerSession: 3.3,
    },
    buckets: [{ key: '2026-09-22', label: '09-22', start: new Date('2026-09-22'), end: new Date('2026-09-22'), turnCount: 1000, answeredCount: 900, unansweredCount: 100, blockedCount: 0, responseRate: 0.9, sessionCount: 300 }],
    ...overrides,
  };
}

function makeDistribution(overrides: Partial<IntegratedDistribution> = {}): IntegratedDistribution {
  return {
    ...PERIOD_META,
    ...SCOPE_META_ALL,
    bySource: [
      { source: 'NODE', count: 600, ratio: 0.6 },
      { source: 'FAQ', count: 250, ratio: 0.25 },
      { source: 'OTHER', count: 0, ratio: 0 },
      { source: 'FALLBACK', count: 150, ratio: 0.15 },
    ],
    byChannel: [{ channelType: 'WEB', sessionCount: 300, ratio: 1 }],
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, turnCount: hour === 10 ? 20 : 1 })),
    byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, turnCount: weekday === 1 ? 30 : 5, responseRate: 0.8 })),
    ...overrides,
  };
}

function makeBreakdown(overrides: Partial<IntegratedBreakdown> = {}): IntegratedBreakdown {
  return {
    ...PERIOD_META,
    ...SCOPE_META_ALL,
    items: [
      {
        kind: 'GROUP',
        id: 'group-1',
        name: '세무 서비스',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        archived: false,
        archivedAt: null,
        missing: false,
        turnCount: 1000,
        answeredCount: 900,
        unansweredCount: 100,
        sessionCount: 300,
        responseRate: 0.9,
        share: 1,
      },
    ],
    othersRow: null,
    unassignedRow: null,
    totals: { turnCount: 1000, sessionCount: 300 },
    shareScale: 10000,
    ...overrides,
  };
}

function makeQuestions(overrides: Partial<IntegratedQuestions> = {}): IntegratedQuestions {
  return {
    ...PERIOD_META,
    ...SCOPE_META_ALL,
    topQuestions: [{ question: '배송 언제 오나요', count: 30, topChatbotId: 'bot-1', topChatbotName: '배송봇' }],
    topUnansweredQuestions: [{ question: '해외배송도 되나요', count: 12, topChatbotId: 'bot-2', topChatbotName: '세무상담봇' }],
    approximated: false,
    candidateLimit: 500,
    includeArchivedChatbots: true,
    ...overrides,
  };
}

function makeGroupOptions(overrides: Partial<IntegratedGroupOptions> = {}): IntegratedGroupOptions {
  return {
    items: [{ id: 'group-1', name: '세무 서비스', createdAt: new Date('2026-01-01T00:00:00.000Z'), archivedAt: null, chatbotCount: 3 }],
    truncated: false,
    ...overrides,
  };
}

function renderPage(initialEntry = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <IntegratedStatsPage />
    </MemoryRouter>,
  );
}

/** G0 통합 통계 axe 접근성 스캔(AC-I6-8). */
describe('IntegratedStatsPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockGetOverview.mockReset();
    mockGetSummary.mockReset();
    mockGetDistribution.mockReset();
    mockGetBreakdown.mockReset();
    mockGetQuestions.mockReset();
    mockGetGroupOptions.mockReset();
  });

  it('정상 데이터(ALL 스코프)에 구조적 접근성 위반이 없다', async () => {
    mockGetGroupOptions.mockResolvedValue(makeGroupOptions());
    mockGetOverview.mockResolvedValue(makeOverview());
    mockGetSummary.mockResolvedValue(makeSummary());
    mockGetDistribution.mockResolvedValue(makeDistribution());
    mockGetBreakdown.mockResolvedValue(makeBreakdown());
    mockGetQuestions.mockResolvedValue(makeQuestions());

    const { container } = renderPage();
    await screen.findByText('세무 서비스');
    await screen.findByText('인기 질문 TOP 1');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('backfillPending 배너가 있는 화면에도 접근성 위반이 없다', async () => {
    mockGetGroupOptions.mockResolvedValue(makeGroupOptions());
    mockGetOverview.mockResolvedValue(makeOverview({ backfillPending: true }));
    mockGetSummary.mockResolvedValue(makeSummary());
    mockGetDistribution.mockResolvedValue(makeDistribution());
    mockGetBreakdown.mockResolvedValue(
      makeBreakdown({ unassignedRow: { turnCount: 10, answeredCount: 8, unansweredCount: 2, sessionCount: 5, responseRate: 0.8, share: 0.01 } }),
    );
    mockGetQuestions.mockResolvedValue(makeQuestions());

    const { container } = renderPage();
    await screen.findByText('과거 데이터 정리 중 — 일부 대화가 집계에서 빠져 있습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('scope=GROUP인데 groupId가 없는 "그룹을 선택해 주세요" 안내 상태에도 접근성 위반이 없다', async () => {
    mockGetGroupOptions.mockResolvedValue(makeGroupOptions());

    const { container } = renderPage('/?scope=GROUP');
    await screen.findByText('그룹을 선택해 주세요.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
