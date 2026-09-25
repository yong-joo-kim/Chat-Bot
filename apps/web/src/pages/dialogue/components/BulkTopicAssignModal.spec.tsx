import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { ApiError } from '../../../api/client';
import { BulkTopicAssignModal } from './BulkTopicAssignModal';

const mockAssign = vi.fn();
vi.mock('../../../api/topics', () => ({
  topicAssignmentsApi: { assign: (...args: unknown[]) => mockAssign(...args) },
}));

const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true }), makeTopic({ id: 'topic-2', name: '보험청구', enabled: false })];

function renderModal(props: Partial<React.ComponentProps<typeof BulkTopicAssignModal>> = {}) {
  return render(
    <ToastProvider>
      <BulkTopicAssignModal
        isOpen
        chatbotId="bot-1"
        resourceKind="INTENT"
        resourceKindLabel="의도"
        selectedIds={['intent-1', 'intent-2']}
        topics={topics}
        onClose={vi.fn()}
        onAssigned={vi.fn()}
        {...props}
      />
    </ToastProvider>,
  );
}

describe('BulkTopicAssignModal', () => {
  beforeEach(() => {
    mockAssign.mockReset();
  });

  it('대상 토픽을 고르고 지정을 누르면 kind·ids·topicId로 assign API를 호출한다', async () => {
    const user = userEvent.setup();
    mockAssign.mockResolvedValue({ kind: 'INTENT', requested: 2, updated: 2, unchanged: 0, targetTopicEnabled: true });
    const onAssigned = vi.fn();
    renderModal({ onAssigned });

    const combobox = screen.getByRole('combobox', { name: /대상 토픽/ });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: '배송' }));
    await user.click(screen.getByRole('button', { name: '지정' }));

    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith('bot-1', { kind: 'INTENT', ids: ['intent-1', 'intent-2'], topicId: 'topic-1' }),
    );
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
  });

  it('비활성 토픽을 대상으로 선택하면 경고 문구가 보인다', async () => {
    const user = userEvent.setup();
    renderModal();

    const combobox = screen.getByRole('combobox', { name: /대상 토픽/ });
    await user.click(combobox);
    await user.click(await screen.findByRole('option', { name: '보험청구(비활성)' }));

    expect(await screen.findByText(/운영 응답에서 즉시 빠집니다/)).toBeInTheDocument();
  });

  it("소속만 바뀌며 '최근 수정순'에 반영되지 않는다는 안내를 항상 보여준다", () => {
    renderModal();
    expect(screen.getByText(/최근 수정순'에는\s*반영되지 않습니다/)).toBeInTheDocument();
  });

  it('INVALID_REFERENCE(부분 삭제된 항목) 오류 시 모달을 유지하고 배너를 표시한다', async () => {
    const user = userEvent.setup();
    mockAssign.mockRejectedValue(new ApiError(404, '이미 삭제됨', 'INVALID_REFERENCE', [{ field: 'id', message: 'x' }]));
    renderModal();

    await user.click(screen.getByRole('button', { name: '지정' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/이미 삭제되어 지정할 수 없습니다/);
  });
});
