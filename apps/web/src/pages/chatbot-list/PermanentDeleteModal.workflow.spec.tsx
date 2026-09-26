import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeChatbotListItem } from '../../test/fixtures';
import { PermanentDeleteModal } from './modals';

const mockSummary = vi.fn();
vi.mock('../../api/workflowSubscriptions', () => ({
  chatbotWorkflowRunsApi: { summary: (...args: unknown[]) => mockSummary(...args) },
}));
vi.mock('../../api/chatbots', () => ({
  chatbotsApi: { permanentDelete: vi.fn() },
}));

/** WF9 — 챗봇 영구삭제 확인 — 대기 건 안내 확장(workflow-automation-ui-spec.md §3.11). */
describe('PermanentDeleteModal — 업무 자동화 대기 건 안내(No.41)', () => {
  beforeEach(() => {
    mockSummary.mockReset();
  });

  it('대기+보류 합이 0보다 크면 함께 취소된다는 안내를 보여준다', async () => {
    mockSummary.mockResolvedValue({ totals: { pending: 2, held: 1 } });
    const chatbot = makeChatbotListItem();

    render(<PermanentDeleteModal chatbot={chatbot} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(await screen.findByText('대기 중인 업무 자동화 요청 3건이 함께 취소됩니다.')).toBeInTheDocument();
  });

  it('대기 건이 없으면 안내를 보여주지 않는다', async () => {
    mockSummary.mockResolvedValue({ totals: { pending: 0, held: 0 } });
    const chatbot = makeChatbotListItem();

    render(<PermanentDeleteModal chatbot={chatbot} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await screen.findByText('영구 삭제 — 되돌릴 수 없습니다');
    expect(screen.queryByText(/대기 중인 업무 자동화 요청/)).not.toBeInTheDocument();
  });

  it('조회가 실패해도 삭제 자체를 막지 않는다(안내만 조용히 생략)', async () => {
    mockSummary.mockRejectedValue(new Error('network'));
    const chatbot = makeChatbotListItem();

    render(<PermanentDeleteModal chatbot={chatbot} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await screen.findByText('영구 삭제 — 되돌릴 수 없습니다');
    expect(screen.getByRole('button', { name: '영구 삭제' })).toBeInTheDocument();
    expect(screen.queryByText(/대기 중인 업무 자동화 요청/)).not.toBeInTheDocument();
  });
});
