import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IntentStats } from '@chat-bot/shared-types';
import { ApiError } from '../../api/client';
import { IntentMatchSection } from './IntentMatchSection';

const mockGetIntentStats = vi.fn();
vi.mock('../../api/stats', () => ({
  statsApi: {
    getIntentStats: (...args: unknown[]) => mockGetIntentStats(...args),
  },
}));

const PERIOD_META = {
  periodStart: new Date('2026-08-24T00:00:00.000Z'),
  periodEnd: new Date('2026-09-22T23:59:59.999Z'),
  granularity: 'DAY' as const,
  timezone: 'Asia/Seoul' as const,
};

function makeIntentStats(overrides: Partial<IntentStats> = {}): IntentStats {
  return {
    ...PERIOD_META,
    chatbotId: '33333333-3333-4333-8333-333333333333',
    generatedAt: new Date('2026-09-22T00:00:00.000Z'),
    totalTurnCount: 1240,
    matchedTurnCount: 980,
    unmatchedTurnCount: 260,
    othersTurnCount: 50,
    distinctIntentCount: 14,
    items: [
      {
        intentId: '44444444-4444-4444-8444-444444444444',
        name: '환급일_문의',
        deleted: false,
        turnCount: 178,
        answeredCount: 167,
        responseRate: 0.94,
        shareOfAll: 0.15,
        shareOfIntentMatched: 0.182,
      },
      {
        intentId: '55555555-5555-4555-8555-555555555555',
        name: null,
        deleted: true,
        turnCount: 8,
        answeredCount: 4,
        responseRate: 0.5,
        shareOfAll: 0.0064,
        shareOfIntentMatched: 0.0081,
      },
    ],
    ...overrides,
  };
}

function renderSection(props: Partial<Parameters<typeof IntentMatchSection>[0]> = {}): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <IntentMatchSection chatbotId="33333333-3333-4333-8333-333333333333" from="" to="" {...props} />
    </MemoryRouter>,
  );
}

describe('IntentMatchSection', () => {
  beforeEach(() => {
    mockGetIntentStats.mockReset();
  });

  it('의도 목록과 요약 문구를 렌더한다(기본 = 의도 매칭 턴 대비 비율)', async () => {
    mockGetIntentStats.mockResolvedValue(makeIntentStats());
    renderSection();

    await screen.findByText('환급일_문의');
    expect(screen.getByText('총 1240턴 · 의도 매칭 980턴 · 미매칭 260턴 · 서로 다른 의도 14개')).toBeInTheDocument();
    expect(screen.getByText('18.2%')).toBeInTheDocument();
    // 기본값에서는 "의도 미매칭" 행이 보이지 않는다(정의상 분모 불일치).
    expect(screen.queryByText('의도 미매칭')).not.toBeInTheDocument();
  });

  it('삭제된 의도는 링크 없이 텍스트로만 표시된다', async () => {
    mockGetIntentStats.mockResolvedValue(makeIntentStats());
    renderSection();

    const deletedCell = await screen.findByText('삭제된 의도(55555555)');
    expect(deletedCell.closest('a')).toBeNull();
  });

  it('"전체 턴 대비" 선택 시 비율 열이 재계산 없이 전환되고 "의도 미매칭" 행이 나타난다', async () => {
    mockGetIntentStats.mockResolvedValue(makeIntentStats());
    renderSection();

    await screen.findByText('환급일_문의');
    fireEvent.click(screen.getByLabelText('전체 턴 대비'));

    expect(await screen.findByText('15.0%')).toBeInTheDocument();
    expect(screen.getByText('의도 미매칭')).toBeInTheDocument();
    // 추가 API 재요청 없이 동일 응답을 재사용한다(F-1).
    expect(mockGetIntentStats).toHaveBeenCalledTimes(1);
  });

  it('빈 상태(의도 매칭 0건)에는 안내 문구를 표시한다', async () => {
    mockGetIntentStats.mockResolvedValue(makeIntentStats({ matchedTurnCount: 0, items: [], distinctIntentCount: 0 }));
    renderSection();

    expect(await screen.findByText('매칭된 의도가 없습니다.')).toBeInTheDocument();
  });

  it('조회 실패 시 오류 상태와 다시 시도 버튼을 보여주고, 재시도하면 다시 호출한다', async () => {
    mockGetIntentStats.mockRejectedValueOnce(new ApiError(500, '요청 실패'));
    mockGetIntentStats.mockResolvedValueOnce(makeIntentStats());
    renderSection();

    await screen.findByText('의도별 매칭을 불러오지 못했습니다.');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    await screen.findByText('환급일_문의');
    expect(mockGetIntentStats).toHaveBeenCalledTimes(2);
  });

  it('기간 상한 초과(STATS_RANGE_TOO_WIDE)에는 서버 메시지를 그대로 보여준다', async () => {
    mockGetIntentStats.mockRejectedValue(new ApiError(400, '조회 기간이 너무 넓습니다.', 'STATS_RANGE_TOO_WIDE'));
    renderSection();

    expect(await screen.findByText('조회 기간이 너무 넓습니다.')).toBeInTheDocument();
  });

  it('의도명 클릭 시 대화설계 의도 편집 화면으로 이동하는 링크를 제공한다', async () => {
    mockGetIntentStats.mockResolvedValue(makeIntentStats());
    renderSection();

    const link = await screen.findByRole('link', { name: /환급일_문의/ });
    expect(link).toHaveAttribute(
      'href',
      '/chatbots/33333333-3333-4333-8333-333333333333/dialogue/intents?resource=intent&edit=44444444-4444-4444-8444-444444444444',
    );
  });
});
