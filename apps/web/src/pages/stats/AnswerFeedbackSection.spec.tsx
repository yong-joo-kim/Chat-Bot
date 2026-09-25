import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { FeedbackStats } from '@chat-bot/shared-types';
import { ApiError } from '../../api/client';
import { AnswerFeedbackSection } from './AnswerFeedbackSection';

expect.extend(toHaveNoViolations);

const mockGetFeedbackStats = vi.fn();
vi.mock('../../api/stats', () => ({
  statsApi: {
    getFeedbackStats: (...args: unknown[]) => mockGetFeedbackStats(...args),
  },
}));

const PERIOD_META = {
  periodStart: new Date('2026-08-24T00:00:00.000Z'),
  periodEnd: new Date('2026-09-22T23:59:59.999Z'),
  granularity: 'DAY' as const,
  timezone: 'Asia/Seoul' as const,
  chatbotId: '33333333-3333-4333-8333-333333333333',
  generatedAt: new Date('2026-09-22T00:00:00.000Z'),
};

function makeStats(overrides: Partial<FeedbackStats> = {}): FeedbackStats {
  return {
    ...PERIOD_META,
    totals: { upCount: 30, downCount: 10, ratedCount: 40, offeredCount: 200, positiveRate: 0.75, participationRate: 0.2, lowSample: false },
    buckets: [{ dayBucket: '2026-09-22', upCount: 30, downCount: 10, offeredCount: 200, positiveRate: 0.75 }],
    topNegativeTargets: [{ kind: 'FAQ', targetId: '66666666-6666-4666-8666-666666666666', name: '환불 안내', deleted: false, downCount: 10, upCount: 2 }],
    lowSampleThreshold: 30,
    ...overrides,
  };
}

function renderSection(canWriteChannel = true): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AnswerFeedbackSection chatbotId={PERIOD_META.chatbotId} from="" to="" canWriteChannel={canWriteChannel} />
    </MemoryRouter>,
  );
}

/** No.44 FB-S1 — "답변 만족도" 4번째 독립 패널(feedback-loop-ui-spec.md §3.4). */
describe('AnswerFeedbackSection — 독립 로딩/오류·빈 상태·저표본', () => {
  beforeEach(() => {
    mockGetFeedbackStats.mockReset();
  });

  it('정상 데이터를 지표 카드·추이 표·상위 대상 표로 렌더한다', async () => {
    mockGetFeedbackStats.mockResolvedValue(makeStats());
    renderSection();

    expect(await screen.findByText('40')).toBeInTheDocument(); // 평가 수
    expect(screen.getByText('👍30 👎10')).toBeInTheDocument();
    // 75.0%는 긍정률 카드 값과 추이 표의 같은 값이 함께 나타난다(1건 이상이면 충분).
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('20.0%')).toBeInTheDocument(); // 참여율
    expect(screen.getByText('환불 안내')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '부정 평가 큐 보기 →' })).toHaveAttribute(
      'href',
      `/chatbots/${PERIOD_META.chatbotId}/stats/learning?source=NEGATIVE_FEEDBACK`,
    );
  });

  it('[R1] 일별 추이는 ChartFrame(표 보기 토글·role=img 요약·SVG aria-hidden)으로 렌더된다', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({
        buckets: [
          { dayBucket: '2026-09-21', upCount: 20, downCount: 10, offeredCount: 150, positiveRate: 0.68 },
          { dayBucket: '2026-09-22', upCount: 30, downCount: 10, offeredCount: 200, positiveRate: 0.75 },
        ],
      }),
    );
    const user = userEvent.setup();
    renderSection();

    await screen.findByText('환불 안내');

    // role="img" 컨테이너가 요약 문장을 aria-label로 제공한다(NFR-A2).
    const summaryText = '최근 2개 구간의 긍정률은 68.0%에서 75.0%로 상승했습니다.';
    expect(screen.getByText(summaryText)).toBeInTheDocument();
    const chartRegion = screen.getByRole('img', { name: summaryText });
    expect(chartRegion.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // 기본 뷰(차트)에서는 표 보기 토글 버튼만 보이고, 표 전용 셀(구간 값)은 아직 없다.
    expect(screen.queryByRole('columnheader', { name: '구간' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '표로 보기' }));

    expect(screen.getByRole('columnheader', { name: '구간' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-21')).toBeInTheDocument();
    expect(screen.getByText('2026-09-22')).toBeInTheDocument();
  });

  it('조회 실패(일반 오류)는 이 섹션에만 오류 상태를 보여주고 다시 시도로 재조회한다', async () => {
    mockGetFeedbackStats.mockRejectedValueOnce(new Error('네트워크 오류')).mockResolvedValueOnce(makeStats());
    const user = userEvent.setup();
    renderSection();

    await screen.findByText('답변 만족도를 불러오지 못했습니다.');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByText('환불 안내')).toBeInTheDocument();
  });

  it('집계 타임아웃(503 AGGREGATION_TIMEOUT)은 전용 문구를 보여준다', async () => {
    mockGetFeedbackStats.mockRejectedValue(new ApiError(503, '지금은 통계를 불러올 수 없습니다.', 'AGGREGATION_TIMEOUT'));
    renderSection();

    expect(await screen.findByText('집계에 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
  });

  it('기간 상한 초과(STATS_RANGE_TOO_WIDE)는 서버 메시지를 그대로 보여준다', async () => {
    mockGetFeedbackStats.mockRejectedValue(new ApiError(400, '조회 기간이 너무 넓습니다.', 'STATS_RANGE_TOO_WIDE'));
    renderSection();

    expect(await screen.findByText('조회 기간이 너무 넓습니다.')).toBeInTheDocument();
  });

  it('offeredCount=0이면 빈 상태 ①을 보여주고, channel:write가 있을 때만 채널 설정 링크가 보인다', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ totals: { upCount: 0, downCount: 0, ratedCount: 0, offeredCount: 0, positiveRate: null, participationRate: null, lowSample: false } }),
    );
    renderSection(true);

    await screen.findByText('이 기간에는 답변 평가가 없습니다.');
    expect(screen.getByRole('link', { name: '채널 설정으로 이동' })).toBeInTheDocument();
  });

  it('offeredCount=0 + channel:write 없음(VIEWER/AGENT)이면 채널 설정 링크가 없다', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ totals: { upCount: 0, downCount: 0, ratedCount: 0, offeredCount: 0, positiveRate: null, participationRate: null, lowSample: false } }),
    );
    renderSection(false);

    await screen.findByText('이 기간에는 답변 평가가 없습니다.');
    expect(screen.queryByRole('link', { name: '채널 설정으로 이동' })).not.toBeInTheDocument();
  });

  it('offeredCount>0 ∧ ratedCount=0이면 빈 상태 ②(노출은 됐지만 평가 없음)를 보여준다', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ totals: { upCount: 0, downCount: 0, ratedCount: 0, offeredCount: 50, positiveRate: null, participationRate: 0, lowSample: false } }),
    );
    renderSection();

    expect(await screen.findByText('평가 버튼은 노출되었지만 아직 남겨진 평가가 없습니다.')).toBeInTheDocument();
  });

  it('저표본(lowSample=true)이면 빈 상태가 아니라 데이터를 그대로 보여주되 긍정률 카드에 캡션이 붙는다', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ totals: { upCount: 5, downCount: 3, ratedCount: 8, offeredCount: 40, positiveRate: 0.625, participationRate: 0.2, lowSample: true } }),
    );
    renderSection();

    await screen.findByText('62.5%');
    expect(screen.getByText(/표본이 적어요/)).toBeInTheDocument();
  });

  it('삭제된 대상은 이름 대신 "삭제됨"으로 표시된다(링크 없음)', async () => {
    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ topNegativeTargets: [{ kind: 'INTENT', deleted: true, downCount: 4, upCount: 1 }] }),
    );
    renderSection();

    expect(await screen.findByText('삭제됨')).toBeInTheDocument();
  });

  it('빠른 재요청(늦게 도착한 이전 응답)이 최신 결과를 덮어쓰지 않는다(useLatestRequest 가드)', async () => {
    let resolveStale: (v: FeedbackStats) => void = () => undefined;
    const stalePromise = new Promise<FeedbackStats>((resolve) => {
      resolveStale = resolve;
    });
    mockGetFeedbackStats.mockImplementationOnce(() => stalePromise).mockImplementationOnce(() => Promise.resolve(makeStats()));
    const { rerender } = renderSection();
    // 두 번째 요청(from 변경)을 곧바로 트리거한다.
    rerender(
      <MemoryRouter>
        <AnswerFeedbackSection chatbotId={PERIOD_META.chatbotId} from="2026-09-01" to="" canWriteChannel={true} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('환불 안내')).toBeInTheDocument();

    resolveStale(makeStats({ topNegativeTargets: [{ kind: 'FAQ', deleted: false, name: '배송 안내', downCount: 99, upCount: 0 }] }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('배송 안내')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('환불 안내')).toBeInTheDocument());
  });

  it('정상 데이터·빈 상태 화면 모두 구조적 접근성 위반이 없다', async () => {
    mockGetFeedbackStats.mockResolvedValue(makeStats());
    const { container } = renderSection();
    await screen.findByText('환불 안내');
    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();

    mockGetFeedbackStats.mockResolvedValue(
      makeStats({ totals: { upCount: 0, downCount: 0, ratedCount: 0, offeredCount: 0, positiveRate: null, participationRate: null, lowSample: false } }),
    );
    const { container: emptyContainer } = renderSection();
    await screen.findByText('이 기간에는 답변 평가가 없습니다.');
    expect(await axe(emptyContainer, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });
});
