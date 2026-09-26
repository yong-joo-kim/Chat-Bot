import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WorkflowSummaryResponse } from '@chat-bot/shared-types';
import { WorkflowSummaryPage } from './WorkflowSummaryPage';

const mockSummary = vi.fn();
vi.mock('../../../api/workflowRuns', () => ({
  workflowRunsApi: { summary: (...args: unknown[]) => mockSummary(...args) },
}));

function makeSummary(overrides: Partial<WorkflowSummaryResponse> = {}): WorkflowSummaryResponse {
  return {
    days: 7,
    timezone: 'Asia/Seoul',
    featureEnabled: true,
    totals: { occurred: 100, succeeded: 90, failed: 5, skipped: 3, cancelled: 1, expired: 1, pending: 0, held: 0 },
    retryRate: 0.05,
    p95DeliveryMs: 640,
    approximated: false,
    byTarget: [],
    byEvent: [],
    daily: [],
    attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 0, oldestPendingMinutes: null, enqueueFailures24h: 0 },
    ...overrides,
  };
}

/** WF1-c — "확인 필요" 항목 클릭 시 조건이 적용된 화면으로 이동(코드리뷰 R1 M-1, ui-spec §3.3). */
describe('WorkflowSummaryPage — 확인 필요 항목 링크', () => {
  beforeEach(() => {
    mockSummary.mockReset();
  });

  it('"연속 실패 대상" 줄은 targets 화면에 ?attention=consecutiveFailures로 연결된다', async () => {
    mockSummary.mockResolvedValue(makeSummary({ attention: { failingTargets: 1, failedRetained: 0, secretMissingTargets: 0, oldestPendingMinutes: null, enqueueFailures24h: 0 } }));
    render(
      <MemoryRouter>
        <WorkflowSummaryPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /연속 실패 대상 1개/ });
    expect(link).toHaveAttribute('href', '/settings/workflow-automation/targets?attention=consecutiveFailures');
  });

  it('"비밀 미설정 대상" 줄은 targets 화면에 ?attention=secretMissing으로 연결된다', async () => {
    mockSummary.mockResolvedValue(
      makeSummary({ attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 2, oldestPendingMinutes: null, enqueueFailures24h: 0 } }),
    );
    render(
      <MemoryRouter>
        <WorkflowSummaryPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /비밀 미설정 대상을 참조하는 노드\/구독 2건/ });
    expect(link).toHaveAttribute('href', '/settings/workflow-automation/targets?attention=secretMissing');
  });

  it('"실패 보관" 줄은 runs 화면에 status=FAILED&retryableOnly=true로 연결된다', async () => {
    mockSummary.mockResolvedValue(
      makeSummary({ attention: { failingTargets: 0, failedRetained: 5, secretMissingTargets: 0, oldestPendingMinutes: null, enqueueFailures24h: 0 } }),
    );
    render(
      <MemoryRouter>
        <WorkflowSummaryPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /실패 보관 5건/ });
    expect(link).toHaveAttribute('href', '/settings/workflow-automation/runs?status=FAILED&retryableOnly=true');
  });

  it('"가장 오래된 대기 건" 줄은 runs 화면에 status=PENDING,HELD로 연결된다', async () => {
    mockSummary.mockResolvedValue(
      makeSummary({ attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 0, oldestPendingMinutes: 42, enqueueFailures24h: 0 } }),
    );
    render(
      <MemoryRouter>
        <WorkflowSummaryPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /가장 오래된 대기 건 42분째/ });
    expect(link).toHaveAttribute('href', '/settings/workflow-automation/runs?status=PENDING,HELD');
  });

  it('확인 필요 항목이 전부 0/null이면 안내 문구만 보여준다', async () => {
    mockSummary.mockResolvedValue(makeSummary());
    render(
      <MemoryRouter>
        <WorkflowSummaryPage />
      </MemoryRouter>,
    );

    await screen.findByText('확인이 필요한 항목이 없습니다.');
  });
});
