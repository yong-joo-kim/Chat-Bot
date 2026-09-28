import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ProactiveStatsResponse } from '@chat-bot/shared-types';
import { ProactiveStatsPanel } from './ProactiveStatsPanel';

const mockGetStats = vi.fn();
vi.mock('../../../api/proactive', () => ({
  proactiveApi: {
    getStats: (...args: unknown[]) => mockGetStats(...args),
  },
}));

function makeStats(daily: ProactiveStatsResponse['daily']): ProactiveStatsResponse {
  return {
    from: '2026-09-01',
    to: '2026-09-07',
    basis: 'BROWSER_REPORTED',
    frequentDismiss: { ratio: 0.5, minShown: 10 },
    totals: [
      {
        ruleId: 'rule-1',
        name: '규칙 1',
        deleted: false,
        shown: daily.reduce((sum, d) => sum + d.shown, 0),
        clicked: 0,
        dismissed: 0,
        optedOut: 0,
        clickRate: null,
        dismissRate: null,
        optOutRate: null,
        frequentlyDismissed: false,
      },
    ],
    daily,
  };
}

function day(d: string, shown: number): ProactiveStatsResponse['daily'][number] {
  return { day: d, ruleId: 'rule-1', shown, clicked: 0, dismissed: 0, optedOut: 0 };
}

function getBarHeights(): number[] {
  return Array.from(document.querySelectorAll('.proactive-stats-bar')).map((el) => parseFloat((el as HTMLElement).style.height));
}

beforeEach(() => {
  mockGetStats.mockReset();
});

describe('ProactiveStatsPanel — 일별 추이 그래프 정규화(Medium #2)', () => {
  it('구간 내 최대값을 100%로 보고 상대 높이를 계산한다(낮은 값 구간)', async () => {
    mockGetStats.mockResolvedValue(makeStats([day('2026-09-01', 1), day('2026-09-02', 2), day('2026-09-03', 1)]));
    render(<ProactiveStatsPanel chatbotId="bot-1" onClose={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('.proactive-stats-bar').length).toBe(3));
    const heights = getBarHeights();
    expect(heights).toEqual([50, 100, 50]);
  });

  it('구간 내 값이 모두 커도(수백 단위) 최대값 기준으로 정규화되어 100%를 넘지 않는다(높은 값 구간)', async () => {
    mockGetStats.mockResolvedValue(makeStats([day('2026-09-01', 500), day('2026-09-02', 250)]));
    render(<ProactiveStatsPanel chatbotId="bot-1" onClose={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('.proactive-stats-bar').length).toBe(2));
    const heights = getBarHeights();
    // 이전 버그(절대값을 그대로 %로 사용 · Math.min(100, d.shown))라면 [100, 100]이 되어
    // 500과 250의 차이가 사라진다 — 정규화 후에는 상대적 차이가 보존되어야 한다.
    expect(heights).toEqual([100, 50]);
  });

  it('구간 내 표시 수가 모두 0이면 모든 막대 높이가 0이다(0으로 나누기 방지)', async () => {
    mockGetStats.mockResolvedValue(makeStats([day('2026-09-01', 0), day('2026-09-02', 0)]));
    render(<ProactiveStatsPanel chatbotId="bot-1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('일별 추이 — 그래프')).toBeInTheDocument());
    const heights = getBarHeights();
    expect(heights).toEqual([0, 0]);
  });
});
