import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WorkflowRunItem } from '@chat-bot/shared-types';
import { makeChatbot } from '../../../test/fixtures';
import { ToastProvider } from '../../../components/Toast';
import { ChatbotWorkflowRunsPage } from './ChatbotWorkflowRunsPage';

const mockList = vi.fn();
const mockRetry = vi.fn();
const mockCancel = vi.fn();

vi.mock('../../../api/workflowSubscriptions', () => ({
  chatbotWorkflowRunsApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: vi.fn().mockResolvedValue({ attention: { oldestPendingMinutes: null } }),
    retry: (...args: unknown[]) => mockRetry(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
  },
}));
vi.mock('../../../api/workflowTargets', () => ({
  workflowTargetsApi: { picker: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock('../../../api/chatbots', () => ({
  chatbotsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({ chatbot: makeChatbot() }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeRun(overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id: '7f1c2e3a-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetName: '그룹웨어 결재 흐름',
    chatbotId: makeChatbot().id,
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

/** WF3-b — 재발송·취소 일괄 처리(ui-spec §3.2b). */
describe('ChatbotWorkflowRunsPage — 재발송/취소', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockRetry.mockReset();
    mockCancel.mockReset();
  });

  it('실패 건을 선택해 재발송하면 확인 모달 뒤 성공 토스트가 뜨고 목록을 다시 조회한다', async () => {
    const run = makeRun();
    mockList.mockResolvedValue({ items: [run], total: 1 });
    mockRetry.mockResolvedValue({ updated: 1 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    fireEvent.click(screen.getByRole('button', { name: '재발송' }));
    fireEvent.click(screen.getByRole('button', { name: '1건 재발송' }));

    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith(makeChatbot().id, { runIds: [run.id] }));
    expect(await screen.findByText('1건을 다시 보냈어요.')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('WORKFLOW_RUN_NOT_RETRYABLE 응답이면 확인 모달에 부분 거부 배너를 보여준다', async () => {
    const run = makeRun();
    const { ApiError } = await import('../../../api/client');
    mockList.mockResolvedValue({ items: [run], total: 1 });
    mockRetry.mockRejectedValue(new ApiError(409, '재발송 불가', 'WORKFLOW_RUN_NOT_RETRYABLE', [{ field: run.id, message: '본문 없음' }]));

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    fireEvent.click(screen.getByRole('button', { name: '재발송' }));
    fireEvent.click(screen.getByRole('button', { name: '1건 재발송' }));

    expect(await screen.findByText('1건은 본문이 이미 사라졌거나 실패 상태가 아니어서 재발송할 수 없습니다.')).toBeInTheDocument();
  });

  it('대기 중인 건을 선택해 취소하면 확인 모달 뒤 성공 토스트가 뜬다', async () => {
    const run = makeRun({ status: 'PENDING', statusReason: null, lastOutcome: null, retryable: false });
    mockList.mockResolvedValue({ items: [run], total: 1 });
    mockCancel.mockResolvedValue({ updated: 1 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '1건 취소' }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith(makeChatbot().id, { runIds: [run.id] }));
    expect(await screen.findByText('1건을 취소했어요.')).toBeInTheDocument();
  });

  it('선택 0건이면 일괄 작업 바가 렌더되지 않는다', async () => {
    mockList.mockResolvedValue({ items: [makeRun()], total: 1 });
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');
    expect(screen.queryByRole('button', { name: '재발송' })).not.toBeInTheDocument();
  });

  it('코드리뷰 R1 L-5 — 페이지를 바꾸면 선택이 초기화된다', async () => {
    const run = makeRun();
    mockList.mockResolvedValue({ items: [run], total: 100 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    expect(screen.getByText('선택 1건')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(makeChatbot().id, expect.objectContaining({ page: 2 })));
    expect(screen.queryByText('선택 1건')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '재발송' })).not.toBeInTheDocument();
  });

  it('코드리뷰 R1 L-5 — 필터를 바꾸면 선택이 초기화된다', async () => {
    const run = makeRun();
    mockList.mockResolvedValue({ items: [run], total: 1 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    expect(screen.getByText('선택 1건')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('재발송 가능만'));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(makeChatbot().id, expect.objectContaining({ retryableOnly: true })));
    expect(screen.queryByText('선택 1건')).not.toBeInTheDocument();
  });

  it('코드리뷰 R1 L-5 — BULK_SIZE_EXCEEDED 응답이면 전용 문구를 확인 모달에 보여준다', async () => {
    const run = makeRun();
    const { ApiError } = await import('../../../api/client');
    mockList.mockResolvedValue({ items: [run], total: 1 });
    mockRetry.mockRejectedValue(new ApiError(400, '한도 초과', 'BULK_SIZE_EXCEEDED'));

    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotWorkflowRunsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getByRole('checkbox', { name: `${run.id} 선택` }));
    fireEvent.click(screen.getByRole('button', { name: '재발송' }));
    fireEvent.click(screen.getByRole('button', { name: '1건 재발송' }));

    expect(await screen.findByText('한 번에 100건까지 처리할 수 있습니다 — 선택을 줄여 다시 시도하세요.')).toBeInTheDocument();
  });
});
