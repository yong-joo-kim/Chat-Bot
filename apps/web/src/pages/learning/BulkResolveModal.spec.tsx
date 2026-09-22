import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { BulkResolveModal } from './BulkResolveModal';
import type { IntentOption } from './ResolveModal';

const mockBulkResolve = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    bulkResolve: (...args: unknown[]) => mockBulkResolve(...args),
  },
}));

const mockIntentsList = vi.fn();
vi.mock('../../api/dialogue', () => ({
  intentsApi: {
    list: (...args: unknown[]) => mockIntentsList(...args),
  },
}));

const CHATBOT_ID = 'chatbot-1';

function makeQuestion(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: 'question-1',
    chatbotId: CHATBOT_ID,
    questionText: '해외배송도 되나요?',
    occurredCount: 12,
    status: 'PENDING',
    firstOccurredAt: new Date('2026-09-01T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-09-22T09:00:00.000Z'),
    recurredCount: 0,
    recurredAfterAt: undefined,
    channelType: 'WEB',
    suggestions: [],
    ...overrides,
  };
}

const INITIAL_OPTIONS: IntentOption[] = [{ id: 'intent-initial', name: '초기목록의도' }];

function renderModal(overrides: Partial<Parameters<typeof BulkResolveModal>[0]> = {}) {
  const onClose = vi.fn();
  const onResult = vi.fn();
  const utils = render(
    <BulkResolveModal
      isOpen
      chatbotId={CHATBOT_ID}
      questions={[makeQuestion()]}
      intentOptions={INITIAL_OPTIONS}
      onClose={onClose}
      onResult={onResult}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onResult };
}

/**
 * `BulkResolveModal`의 디바운스 서버 검색 회귀 테스트. `ResolveModal.spec.tsx`(M-2)와 동일한 문제 —
 * 상위 `intentOptions`가 최대 100건만 로드되므로 101번째 이후 의도는 입력값 기반 디바운스 검색
 * (`intentsApi.list({ q })`)으로만 매칭될 수 있다.
 */
describe('BulkResolveModal — 디바운스 서버 검색', () => {
  beforeEach(() => {
    mockBulkResolve.mockReset();
    mockIntentsList.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('빈 입력 상태에서는 서버 검색을 호출하지 않고 초기 목록(intentOptions)만 사용한다', async () => {
    renderModal();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockIntentsList).not.toHaveBeenCalled();
  });

  it('입력 후 300ms가 지나야 디바운스 검색이 발생한다(그 전에는 호출하지 않는다)', async () => {
    mockIntentsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), '배송');
    await vi.advanceTimersByTimeAsync(200);
    expect(mockIntentsList).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalledWith(CHATBOT_ID, { q: '배송', pageSize: 50 }));
  });

  it('디바운스 검색 결과에서 일치하는 의도를 찾으면 "기존 의도에 추가됩니다" 안내로 바뀐다(초기 100건 밖의 의도)', async () => {
    mockIntentsList.mockResolvedValue({
      items: [{ id: 'intent-101', name: '검색으로만찾는의도' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), '검색으로만찾는의도');
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByText(/기존 의도 '검색으로만찾는의도'에 예문이 추가됩니다/)).toBeInTheDocument());
  });

  it('경쟁 조건 방지: 느린 이전 검색 응답이 더 최신 검색 결과를 덮어쓰지 않는다', async () => {
    let resolveFirst!: (v: { items: IntentOption[]; total: number; page: number; pageSize: number }) => void;
    const firstSearch = new Promise<{ items: IntentOption[]; total: number; page: number; pageSize: number }>((res) => {
      resolveFirst = res;
    });
    const secondSearch = Promise.resolve({
      items: [{ id: 'intent-b', name: 'ㅁ검색어B의도' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    mockIntentsList.mockImplementationOnce(() => firstSearch).mockImplementationOnce(() => secondSearch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();
    const input = screen.getByLabelText('반영할 의도');

    await user.type(input, '검색어A');
    await vi.advanceTimersByTimeAsync(310);
    expect(mockIntentsList).toHaveBeenCalledTimes(1);

    await user.clear(input);
    await user.type(input, 'ㅁ검색어B의도');
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/기존 의도 'ㅁ검색어B의도'에 예문이 추가됩니다/)).toBeInTheDocument());

    resolveFirst({ items: [{ id: 'intent-a', name: '검색어A의도' }], total: 1, page: 1, pageSize: 50 });
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText(/기존 의도 'ㅁ검색어B의도'에 예문이 추가됩니다/)).toBeInTheDocument();
  });

  it('검색어를 지우면 초기 목록(intentOptions)으로 되돌아간다', async () => {
    mockIntentsList.mockResolvedValue({ items: [{ id: 'intent-x', name: '검색결과의도' }], total: 1, page: 1, pageSize: 50 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();
    const input = screen.getByLabelText('반영할 의도');

    await user.type(input, '검색결과의도');
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(screen.getByText(/기존 의도 '검색결과의도'에 예문이 추가됩니다/)).toBeInTheDocument());

    await user.clear(input);
    await waitFor(() => expect(screen.queryByText(/예문이 추가됩니다/)).not.toBeInTheDocument());
  });

  it('검색 실패 시에도 예외 없이 초기 목록(intentOptions) 매칭으로 폴백한다', async () => {
    mockIntentsList.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), INITIAL_OPTIONS[0].name);
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByText(new RegExp(`기존 의도 '${INITIAL_OPTIONS[0].name}'에 예문이 추가됩니다`))).toBeInTheDocument());
  });

  it('검색 결과로 매칭된 의도로 제출하면 모든 항목에 intentId를 사용한다(intentName은 보내지 않는다)', async () => {
    mockIntentsList.mockResolvedValue({
      items: [{ id: 'intent-101', name: '검색으로만찾는의도' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    mockBulkResolve.mockResolvedValue({ succeeded: 2, results: [], failed: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const questions = [makeQuestion({ id: 'q-1' }), makeQuestion({ id: 'q-2' })];
    const { onResult } = renderModal({ questions });

    await user.type(screen.getByLabelText('반영할 의도'), '검색으로만찾는의도');
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(screen.getByText(/기존 의도 '검색으로만찾는의도'에 예문이 추가됩니다/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() =>
      expect(mockBulkResolve).toHaveBeenCalledWith(CHATBOT_ID, {
        items: [
          { id: 'q-1', intentId: 'intent-101' },
          { id: 'q-2', intentId: 'intent-101' },
        ],
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalled());
  });
});

describe('BulkResolveModal — 제출/오류 처리', () => {
  beforeEach(() => {
    mockBulkResolve.mockReset();
    mockIntentsList.mockReset();
  });

  it('초기 목록에 일치하는 의도가 있으면 intentId로 bulkResolve를 호출한다', async () => {
    const user = userEvent.setup();
    const { onResult } = renderModal();
    mockBulkResolve.mockResolvedValue({ succeeded: 1, results: [], failed: [] });

    await user.type(screen.getByLabelText('반영할 의도'), '초기목록의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() =>
      expect(mockBulkResolve).toHaveBeenCalledWith(CHATBOT_ID, {
        items: [{ id: 'question-1', intentId: 'intent-initial' }],
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalled());
  });

  it('일치하는 의도가 없으면 intentName으로 제출한다(새 의도 생성 경로)', async () => {
    const user = userEvent.setup();
    renderModal();
    mockBulkResolve.mockResolvedValue({ succeeded: 1, results: [], failed: [] });

    await user.type(screen.getByLabelText('반영할 의도'), '신규의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() =>
      expect(mockBulkResolve).toHaveBeenCalledWith(CHATBOT_ID, {
        items: [{ id: 'question-1', intentName: '신규의도' }],
      }),
    );
  });

  it('제출 실패 시 오류 배너를 표시한다', async () => {
    const { ApiError } = await import('../../api/client');
    mockBulkResolve.mockRejectedValue(new ApiError(400, '처리 중 오류가 발생했습니다.', 'VALIDATION_FAILED'));
    const user = userEvent.setup();
    const { onResult } = renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), '초기목록의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('처리 중 오류가 발생했습니다.'));
    expect(onResult).not.toHaveBeenCalled();
  });
});
