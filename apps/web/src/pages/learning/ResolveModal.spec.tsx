import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { ResolveModal, type IntentOption } from './ResolveModal';

const mockResolve = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    resolve: (...args: unknown[]) => mockResolve(...args),
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

function renderModal(overrides: Partial<Parameters<typeof ResolveModal>[0]> = {}) {
  const onClose = vi.fn();
  const onResolved = vi.fn();
  const onAlreadyResolved = vi.fn();
  const utils = render(
    <ResolveModal
      isOpen
      chatbotId={CHATBOT_ID}
      question={makeQuestion()}
      intentOptions={INITIAL_OPTIONS}
      onClose={onClose}
      onResolved={onResolved}
      onAlreadyResolved={onAlreadyResolved}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onResolved, onAlreadyResolved };
}

/**
 * `ResolveModal`의 디바운스 서버 검색(M-2 code-reviewer 수정사항) 전용 회귀 테스트.
 * 초기 의도 목록은 최대 100건만 로드되므로(상위 `LearningQueuePage`), 101번째 이후 의도는
 * 입력값 기반 디바운스 검색(`intentsApi.list({ q })`)으로만 매칭될 수 있다.
 */
describe('ResolveModal — 디바운스 서버 검색(M-2)', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockIntentsList.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('빈 입력 상태에서는 서버 검색을 호출하지 않고 초기 목록(intentOptions)만 사용한다', async () => {
    renderModal();
    // 아무 것도 입력하지 않은 상태 — 300ms를 흘려보내도 검색은 발생하지 않는다.
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
    // 초기 목록(intentOptions)에는 없는 의도 — 검색으로만 발견 가능하다(101번째 이후 의도의 대표 사례).
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

    // 1차 검색어 입력 → 300ms 경과로 1차 검색 발동(아직 응답 대기 중, 느린 네트워크를 흉내낸다).
    await user.type(input, '검색어A');
    await vi.advanceTimersByTimeAsync(310);
    expect(mockIntentsList).toHaveBeenCalledTimes(1);

    // 1차 응답이 오기 전에 사용자가 입력을 지우고 2차 검색어를 새로 입력한다 → 2차 검색이 발동하고 먼저 응답한다.
    // (두 번째 검색어는 그 결과 목록의 의도명과 정규화 기준으로 정확히 일치해야 "기존 의도" 안내가 뜬다.)
    await user.clear(input);
    await user.type(input, 'ㅁ검색어B의도');
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/기존 의도 'ㅁ검색어B의도'에 예문이 추가됩니다/)).toBeInTheDocument());

    // 이제야 1차(느린) 검색이 응답한다 — 최신 검색어가 아니므로 결과를 반영하면 안 된다(latestSearchTermRef 가드).
    resolveFirst({ items: [{ id: 'intent-a', name: '검색어A의도' }], total: 1, page: 1, pageSize: 50 });
    await vi.advanceTimersByTimeAsync(0);

    // 여전히 2차(최신) 검색 결과가 유지되어야 한다 — 1차 응답에 의해 되돌려지지 않는다.
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
    // 빈 입력은 안내가 "새 의도를 만들어야 하는지 여부를 판단하기 전" 상태(플레이스홀더 힌트)로 돌아간다.
    await waitFor(() => expect(screen.queryByText(/예문이 추가됩니다/)).not.toBeInTheDocument());
  });

  it('검색 실패 시에도 예외 없이 초기 목록(intentOptions) 매칭으로 폴백한다', async () => {
    mockIntentsList.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), INITIAL_OPTIONS[0].name);
    await vi.advanceTimersByTimeAsync(310);
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalled());

    // 검색은 실패했지만 초기 목록에 있던 이름이므로 여전히 "기존 의도"로 매칭된다(폴백 성공).
    await waitFor(() => expect(screen.getByText(new RegExp(`기존 의도 '${INITIAL_OPTIONS[0].name}'에 예문이 추가됩니다`))).toBeInTheDocument());
  });
});

describe('ResolveModal — 제출/오류 처리', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockIntentsList.mockReset();
  });

  it('일치하는 기존 의도를 선택해 제출하면 intentId로 resolve를 호출한다(intentName은 보내지 않는다)', async () => {
    const user = userEvent.setup();
    const { onResolved } = renderModal();
    mockResolve.mockResolvedValue({
      questionId: 'question-1',
      intentId: 'intent-initial',
      intentName: '초기목록의도',
      created: false,
      exampleCount: 1,
      linkedNodeCount: 1,
      conflicts: [],
      appliedImmediately: true,
    });

    await user.type(screen.getByLabelText('반영할 의도'), '초기목록의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith(CHATBOT_ID, 'question-1', {
        intentId: 'intent-initial',
        intentName: undefined,
        exampleText: '해외배송도 되나요?',
      }),
    );
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it('일치하는 의도가 없으면 intentName으로 제출한다(새 의도 생성 경로)', async () => {
    const user = userEvent.setup();
    renderModal();
    mockResolve.mockResolvedValue({
      questionId: 'question-1',
      intentId: 'new-intent',
      intentName: '신규의도',
      created: true,
      exampleCount: 1,
      linkedNodeCount: 0,
      conflicts: [],
      appliedImmediately: true,
    });

    await user.type(screen.getByLabelText('반영할 의도'), '신규의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith(CHATBOT_ID, 'question-1', {
        intentId: undefined,
        intentName: '신규의도',
        exampleText: '해외배송도 되나요?',
      }),
    );
  });

  it('LIMIT_EXCEEDED 오류는 모달을 유지하고 상단 배너를 표시한다', async () => {
    const { ApiError } = await import('../../api/client');
    mockResolve.mockRejectedValue(new ApiError(400, '예문 상한을 초과했습니다.', 'LIMIT_EXCEEDED'));
    const user = userEvent.setup();
    const { onResolved } = renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), '초기목록의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/예문 500개로 상한/));
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('ALREADY_RESOLVED 오류는 onAlreadyResolved를 호출한다(동시 경합, AC-15B-11)', async () => {
    const { ApiError } = await import('../../api/client');
    mockResolve.mockRejectedValue(new ApiError(409, '이미 처리되었습니다.', 'ALREADY_RESOLVED'));
    const user = userEvent.setup();
    const { onAlreadyResolved } = renderModal();

    await user.type(screen.getByLabelText('반영할 의도'), '초기목록의도');
    await user.click(screen.getByRole('button', { name: '반영' }));

    await waitFor(() => expect(onAlreadyResolved).toHaveBeenCalled());
  });
});
