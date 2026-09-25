import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { ApiError } from '../../../api/client';
import { DeleteTopicConfirmDialog } from './DeleteTopicConfirmDialog';

const mockRemove = vi.fn();
vi.mock('../../../api/topics', () => ({
  topicsApi: { remove: (...args: unknown[]) => mockRemove(...args) },
}));

describe('DeleteTopicConfirmDialog', () => {
  it('자산 0건이면 즉시 삭제 문구가 보이고, 확인 시 moveToCommon:false로 삭제한다', async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const topic = makeTopic({ id: 'topic-1', name: '배송' });
    render(
      <ToastProvider>
        <DeleteTopicConfirmDialog
          isOpen
          chatbotId="bot-1"
          topic={topic}
          counts={{ intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 }}
          onClose={vi.fn()}
          onDeleted={onDeleted}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('bot-1', 'topic-1', { moveToCommon: false }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('자산이 있으면 종류별 건수와 "공통으로 옮기고 삭제" 버튼이 보인다', () => {
    const topic = makeTopic({ id: 'topic-2', name: '보험청구' });
    render(
      <ToastProvider>
        <DeleteTopicConfirmDialog
          isOpen
          chatbotId="bot-1"
          topic={topic}
          counts={{ intents: 8, keywords: 10, homonyms: 1, contexts: 2, dialogNodes: 6, faqs: 9 }}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: '공통으로 옮기고 삭제' })).toBeInTheDocument();
    expect(screen.getByText('의도 8')).toBeInTheDocument();
    expect(screen.getByText('FAQ 9')).toBeInTheDocument();
  });

  /** [코드 리뷰 1회차 M-5] 409 TOPIC_NOT_EMPTY가 다시 오면 대화상자를 닫지 않고 재조회를 위임한다. */
  it('삭제 확정 중 409 TOPIC_NOT_EMPTY가 다시 오면 대화상자를 닫지 않고 onStaleCounts를 호출한다', async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue(new ApiError(409, '자산이 있습니다.', 'TOPIC_NOT_EMPTY'));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    const onStaleCounts = vi.fn();
    const topic = makeTopic({ id: 'topic-2', name: '보험청구' });
    render(
      <ToastProvider>
        <DeleteTopicConfirmDialog
          isOpen
          chatbotId="bot-1"
          topic={topic}
          counts={{ intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 }}
          onClose={onClose}
          onDeleted={onDeleted}
          onStaleCounts={onStaleCounts}
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(onStaleCounts).toHaveBeenCalledTimes(1));
    expect(screen.getByText('자산이 늘어났습니다. 다시 확인해 주세요.')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
