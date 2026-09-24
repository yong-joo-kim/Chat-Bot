import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IntegratedOverview } from '@chat-bot/shared-types';
import { CumulativeKpiCards } from './CumulativeKpiCards';

function makeOverview(overrides: Partial<IntegratedOverview> = {}): IntegratedOverview {
  return {
    scope: 'ALL',
    groupId: null,
    backfillPending: false,
    generatedAt: new Date('2026-09-24T00:00:00.000Z'),
    timezone: 'Asia/Seoul',
    group: null,
    totals: {
      turnCount: 431204,
      answeredCount: 391000,
      unansweredCount: 40204,
      blockedCount: 0,
      responseRate: 0.908,
      noResponseRate: 0.092,
      sessionCount: 98120,
      visitCountBasis: 'SESSION',
      turnsPerSession: 4.4,
    },
    firstDayBucket: '2024-03-02',
    chatbotCounts: { active: 12, draft: 3, archived: 2 },
    ...overrides,
  };
}

describe('CumulativeKpiCards', () => {
  it('누적 KPI 4장과 집계 시작일 캡션을 렌더한다', () => {
    render(<CumulativeKpiCards overview={makeOverview()} />);
    expect(screen.getByText('431204')).toBeInTheDocument();
    expect(screen.getByText('90.8%')).toBeInTheDocument();
    expect(screen.getByText('98120')).toBeInTheDocument();
    expect(screen.getByText('운영 12 · 초안 3 · 보관 2')).toBeInTheDocument();
    expect(screen.getByText(/부터 집계/)).toBeInTheDocument();
  });

  it('firstDayBucket이 없으면(AC-I2-5) "아직 집계된 대화가 없습니다"를 보여준다(오류 아님)', () => {
    render(<CumulativeKpiCards overview={makeOverview({ firstDayBucket: null })} />);
    expect(screen.getByText('아직 집계된 대화가 없습니다.')).toBeInTheDocument();
  });
});
