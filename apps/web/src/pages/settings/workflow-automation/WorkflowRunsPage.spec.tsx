import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WorkflowRunItem } from '@chat-bot/shared-types';
import { WorkflowRunsPage } from './WorkflowRunsPage';

function renderPage(initialEntry = '/settings/workflow-automation/runs'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkflowRunsPage />
    </MemoryRouter>,
  );
}

const mockList = vi.fn();
const mockSummary = vi.fn();

vi.mock('../../../api/workflowRuns', () => ({
  workflowRunsApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: (...args: unknown[]) => mockSummary(...args),
  },
  buildWorkflowRunQuery: vi.fn(() => ''),
}));
vi.mock('../../../api/workflowTargets', () => ({
  workflowTargetsApi: { picker: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock('../../../api/chatbots', () => ({
  chatbotsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));

function makeRun(overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id: '7f1c2e3a-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetName: '그룹웨어 결재 흐름',
    chatbotId: '22222222-2222-4222-8222-222222222222',
    triggerKind: 'NODE',
    eventType: 'NODE_ACTION',
    actionKey: 'leave.request',
    nodeId: '33333333-3333-4333-8333-333333333333',
    subscriptionId: null,
    sessionRef: 'a1b2c3d4e5f60718',
    status: 'FAILED',
    statusReason: 'PERMANENT_ERROR',
    holdReason: null,
    attemptCount: 5,
    nextAttemptAt: null,
    lastOutcome: 'HTTP_ERROR',
    lastHttpStatus: 400,
    lastLatencyMs: 210,
    personalDataMasked: true,
    fieldNames: ['start'],
    retryable: true,
    payloadPurged: false,
    manualRetryCount: 0,
    createdAt: new Date('2026-09-26T01:01:58.000Z'),
    completedAt: new Date('2026-09-26T01:01:58.500Z'),
    ...overrides,
  };
}

/** WF1-b — 실행 이력(전역, workflow-automation-ui-spec.md §3.2). */
describe('WorkflowRunsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockSummary.mockReset();
    mockSummary.mockResolvedValue({ attention: { oldestPendingMinutes: null } });
  });

  it('대기 건이 오래됐으면(오래된 대기 경고) 배너를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [makeRun({ status: 'PENDING', statusReason: null })], total: 1 });
    mockSummary.mockResolvedValue({ attention: { oldestPendingMinutes: 42 } });

    renderPage();

    await screen.findByText('그룹웨어 결재 흐름');
    expect(await screen.findByText(/가장 오래된 대기 건이 42분째/)).toBeInTheDocument();
  });

  it('조건에 해당하는 이력이 없으면 빈 상태 문구를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    await screen.findByText('선택한 조건에 해당하는 실행 이력이 없습니다.');
  });

  it('목록이 있으면 챗봇 열을 포함한 표를 렌더한다', async () => {
    mockList.mockResolvedValue({ items: [makeRun()], total: 1 });
    renderPage();

    await screen.findByText('그룹웨어 결재 흐름');
    expect(screen.getAllByText('챗봇').length).toBeGreaterThan(0);
  });

  it('코드리뷰 R1 M-1 — 쿼리스트링(status·retryableOnly)을 초기 필터로 읽어 조회한다(WF1-c에서 이동)', async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });
    renderPage('/settings/workflow-automation/runs?status=FAILED&retryableOnly=true');

    await screen.findByText('선택한 조건에 해당하는 실행 이력이 없습니다.');
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: ['FAILED'], retryableOnly: true }));
  });

  it('코드리뷰 R1 M-1 — status에 콤마 구분 다중값(PENDING,HELD)도 배열로 읽는다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });
    renderPage('/settings/workflow-automation/runs?status=PENDING,HELD');

    await screen.findByText('선택한 조건에 해당하는 실행 이력이 없습니다.');
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: ['PENDING', 'HELD'] }));
  });
});
