import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { ApiError } from '../../../api/client';
import { HomonymEditModal } from './HomonymEditModal';

const mockFindOne = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../../api/dialogue', () => ({
  homonymsApi: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    test: vi.fn(),
  },
  intentsApi: { findOne: vi.fn() },
}));

const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];

function renderModal() {
  return render(
    <ToastProvider>
      <HomonymEditModal isOpen chatbotId="bot-1" homonymId={null} topics={topics} onClose={vi.fn()} onSaved={vi.fn()} />
    </ToastProvider>,
  );
}

async function fillMinimumAndSubmit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/단어/), '배');
  const labelInputs = screen.getAllByLabelText(/의미명/);
  await user.type(labelInputs[0], '뜻1');
  await user.type(labelInputs[1], '뜻2');
  await user.click(screen.getByRole('button', { name: '저장' }));
}

/** [코드 리뷰 1회차 H-1] `INVALID_REFERENCE`를 `details[].field`로 구분한다. */
describe('HomonymEditModal — INVALID_REFERENCE 구분(H-1)', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it("field가 'topicId'면 TopicSelectField에 인라인 오류가 뜨고, 기존 연결 의도 오류 문구는 뜨지 않는다", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError(404, '선택한 토픽을 찾을 수 없습니다.', 'INVALID_REFERENCE', [{ field: 'topicId', message: 'topic-x' }]));
    renderModal();

    await fillMinimumAndSubmit(user);

    expect(await screen.findByText('선택한 토픽을 찾을 수 없습니다. 새로고침해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('선택한 의도를 찾을 수 없습니다.')).not.toBeInTheDocument();
  });

  it("field가 'meanings.intentId'면 기존처럼 연결 의도 오류 문구가 뜬다", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new ApiError(404, '선택한 의도를 찾을 수 없습니다.', 'INVALID_REFERENCE', [{ field: 'meanings.intentId', message: 'intent-x' }]),
    );
    renderModal();

    await fillMinimumAndSubmit(user);

    expect(await screen.findByText('선택한 의도를 찾을 수 없습니다.')).toBeInTheDocument();
  });
});
