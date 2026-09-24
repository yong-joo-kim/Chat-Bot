import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  IntegratedBreakdown,
  IntegratedDistribution,
  IntegratedGroupOptions,
  IntegratedOverview,
  IntegratedQuestions,
  IntegratedSummary,
} from '@chat-bot/shared-types';
import { ApiError } from '../../api/client';
import { IntegratedStatsPage } from './IntegratedStatsPage';

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
const SCOPE_META_ALL = { scope: 'ALL' as const, groupId: null, backfillPending: false, generatedAt: new Date('2026-09-24T00:00:00.000Z'), timezone: 'Asia/Seoul' as const };

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
    buckets: [],
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
    topUnansweredQuestions: [],
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

function mockAllSuccess(): void {
  mockGetGroupOptions.mockResolvedValue(makeGroupOptions());
  mockGetOverview.mockResolvedValue(makeOverview());
  mockGetSummary.mockResolvedValue(makeSummary());
  mockGetDistribution.mockResolvedValue(makeDistribution());
  mockGetBreakdown.mockResolvedValue(makeBreakdown());
  mockGetQuestions.mockResolvedValue(makeQuestions());
}

function renderPage(initialEntry = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<IntegratedStatsPage />} />
        <Route path="/chatbots/:chatbotId/stats/overview" element={<p>챗봇 통계 화면(이동 확인용)</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('IntegratedStatsPage', () => {
  beforeEach(() => {
    mockGetOverview.mockReset();
    mockGetSummary.mockReset();
    mockGetDistribution.mockReset();
    mockGetBreakdown.mockReset();
    mockGetQuestions.mockReset();
    mockGetGroupOptions.mockReset();
  });

  it('scope=ALL(기본값)로 6개 API를 호출하고 결과를 렌더한다', async () => {
    mockAllSuccess();
    renderPage();

    await screen.findByText('통합 통계');
    await screen.findByText('세무 서비스'); // 기여 표

    expect(mockGetGroupOptions).toHaveBeenCalledTimes(1);
    expect(mockGetOverview).toHaveBeenCalledWith({ scope: 'ALL', groupId: undefined });
    expect(mockGetBreakdown).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ALL', groupId: undefined }));
    expect(mockGetQuestions).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ALL', includeArchivedChatbots: true }));
  });

  it('/stats/integrated/breakdown은 granularity를 보내지 않는다(코드리뷰 L-2, IntegratedBreakdownQuerySchema 계약)', async () => {
    mockAllSuccess();
    renderPage();

    await screen.findByText('세무 서비스');

    expect(mockGetBreakdown).toHaveBeenCalledWith({ scope: 'ALL', groupId: undefined, from: undefined, to: undefined });
    const breakdownCallArgs = mockGetBreakdown.mock.calls[0][0] as Record<string, unknown>;
    expect(breakdownCallArgs).not.toHaveProperty('granularity');
  });

  it('scope=GROUP인데 groupId가 없으면 5개 API를 호출하지 않고 안내만 보여준다(EX-I-2 선제 방지)', async () => {
    mockGetGroupOptions.mockResolvedValue(makeGroupOptions());
    renderPage('/?scope=GROUP');

    await screen.findByText('그룹을 선택해 주세요.');
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(mockGetSummary).not.toHaveBeenCalled();
    expect(mockGetBreakdown).not.toHaveBeenCalled();
  });

  it('scope=GROUP&groupId=...면 groupId를 실어 5개 API를 호출한다', async () => {
    mockAllSuccess();
    renderPage('/?scope=GROUP&groupId=group-1');

    await waitFor(() => expect(mockGetOverview).toHaveBeenCalledWith({ scope: 'GROUP', groupId: 'group-1' }));
  });

  it('존재하지 않는 groupId(404)는 5개 영역을 안내 화면으로 대체하고, "전체 통계로 이동" 클릭 시 scope=ALL로 재요청한다', async () => {
    mockGetGroupOptions.mockResolvedValue(makeGroupOptions());
    mockGetOverview.mockRejectedValue(new ApiError(404, '그룹을 찾을 수 없습니다.', 'NOT_FOUND'));
    mockGetSummary.mockRejectedValue(new ApiError(404, '그룹을 찾을 수 없습니다.', 'NOT_FOUND'));
    mockGetDistribution.mockRejectedValue(new ApiError(404, '그룹을 찾을 수 없습니다.', 'NOT_FOUND'));
    mockGetBreakdown.mockRejectedValue(new ApiError(404, '그룹을 찾을 수 없습니다.', 'NOT_FOUND'));
    mockGetQuestions.mockRejectedValue(new ApiError(404, '그룹을 찾을 수 없습니다.', 'NOT_FOUND'));
    renderPage('/?scope=GROUP&groupId=ghost-group');

    await screen.findByText('선택한 그룹을 찾을 수 없습니다.');
    mockAllSuccess();
    await userEvent.setup().click(screen.getByRole('button', { name: '전체 통계로 이동' }));

    await waitFor(() => expect(mockGetOverview).toHaveBeenLastCalledWith({ scope: 'ALL', groupId: undefined }));
  });

  it('응답 중 하나라도 backfillPending이면 배너를 보여준다', async () => {
    mockAllSuccess();
    mockGetBreakdown.mockResolvedValue(makeBreakdown({ backfillPending: true }));
    renderPage();

    expect(await screen.findByText('과거 데이터 정리 중 — 일부 대화가 집계에서 빠져 있습니다.')).toBeInTheDocument();
  });

  it('스코프 내 로그 0건이면 KPI는 정상 표시하고 나머지 영역은 빈 상태로 안내한다(AC-I2-5)', async () => {
    mockAllSuccess();
    mockGetOverview.mockResolvedValue(
      makeOverview({
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
      }),
    );
    renderPage();

    expect(await screen.findByText('이 범위에 집계된 대화 기록이 없습니다.')).toBeInTheDocument();
    // KPI 카드는 0건도 "정상 완료"로 표시한다(오류 아님, AC-I2-5).
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('운영 12 · 초안 3 · 보관 2')).toBeInTheDocument();
  });

  it('빠른 스코프 전환 시 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않는다(요청 순번 가드)', async () => {
    mockAllSuccess();
    let resolveStaleAll: (value: IntegratedOverview) => void = () => undefined;
    const staleAllPromise = new Promise<IntegratedOverview>((resolve) => {
      resolveStaleAll = resolve;
    });
    mockGetOverview
      .mockImplementationOnce(() => staleAllPromise) // 1차 호출(scope=ALL) — 응답이 늦게 온다.
      .mockImplementationOnce(() => Promise.resolve(makeOverview({ chatbotCounts: { active: 9, draft: 0, archived: 0 } }))); // 2차 호출(scope=GROUP) — 먼저 도착.

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('통합 통계');

    await user.click(screen.getByRole('radio', { name: '그룹' }));
    await user.selectOptions(screen.getByLabelText('그룹 선택'), 'group-1');

    // 2차(그룹) 응답이 먼저 반영된다.
    expect(await screen.findByText('운영 9 · 초안 0 · 보관 0')).toBeInTheDocument();

    // 뒤늦게 도착한 1차(전체) 응답은 무시되어야 한다.
    resolveStaleAll(makeOverview({ chatbotCounts: { active: 99, draft: 0, archived: 0 } }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('운영 9 · 초안 0 · 보관 0')).toBeInTheDocument();
    expect(screen.queryByText('운영 99 · 초안 0 · 보관 0')).not.toBeInTheDocument();
  });

  it('AC-I6-6: 집계 타임아웃(503 AGGREGATION_TIMEOUT)은 일반 오류와 다른 안내 문구를 보여준다', async () => {
    mockAllSuccess();
    mockGetOverview.mockRejectedValue(new ApiError(503, '지금은 통계를 불러올 수 없습니다.', 'AGGREGATION_TIMEOUT'));
    renderPage();

    expect(await screen.findByText('집계에 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
    // 일반 오류 문구(errorTitle)와는 구분되어야 한다 — 같은 문구로 뭉뚱그리지 않는다(FR-I8-7).
    expect(screen.queryByText('통계를 불러오지 못했습니다.')).not.toBeInTheDocument();
  });

  it('기여 표에서 챗봇 행을 클릭하면 해당 챗봇 통계 화면으로 이동한다', async () => {
    mockAllSuccess();
    mockGetBreakdown.mockResolvedValue(
      makeBreakdown({
        items: [
          {
            kind: 'CHATBOT',
            id: 'bot-1',
            name: '연말정산봇',
            status: 'ACTIVE',
            archivedAt: null,
            currentGroupId: null,
            currentGroupName: null,
            turnCount: 100,
            answeredCount: 90,
            unansweredCount: 10,
            sessionCount: 30,
            responseRate: 0.9,
            share: 1,
          },
        ],
      }),
    );
    renderPage();

    const link = await screen.findByRole('button', { name: /연말정산봇/ });
    await userEvent.setup().click(link);

    expect(await screen.findByText('챗봇 통계 화면(이동 확인용)')).toBeInTheDocument();
  });
});
