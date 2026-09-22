import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionDetail, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { StatsShellContext } from '../stats/StatsShell';
import { LearningQueuePage } from './LearningQueuePage';

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });
const HIGHLIGHT_ID = '99999999-9999-4999-8999-999999999999';
const HIGHLIGHT_TEXT = '포장 선물 되나요?';

const mockShellContext: StatsShellContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
  learningSummary: { pendingCount: 1, limitReached: false },
  refreshLearningSummary: vi.fn(),
};

vi.mock('../stats/StatsShell', () => ({
  useStatsShellContext: () => mockShellContext,
}));

let canWrite = true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'dialogue:write' ? canWrite : true) }),
}));

const mockList = vi.fn();
const mockFindOne = vi.fn();
const mockIgnore = vi.fn();
const mockReopen = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: vi.fn(),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    resolve: vi.fn(),
    ignore: (...args: unknown[]) => mockIgnore(...args),
    reopen: (...args: unknown[]) => mockReopen(...args),
    bulkResolve: vi.fn(),
    bulkIgnore: vi.fn(),
  },
}));

vi.mock('../../api/dialogue', () => ({
  intentsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
  keywordsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
}));

// B1 분류기 상태 패널(learning-augmentation-ui-spec.md §5.2)이 L1 상단에서 항상 조회한다 —
// 이 스펙은 그 기능 자체를 다루지 않으므로 최소 응답으로 목 처리해 무관한 네트워크 호출을 막는다.
vi.mock('../../api/classifier', () => ({
  classifierApi: {
    status: vi.fn().mockResolvedValue({ state: 'NONE', classCount: 0, sampleCount: 0, stale: false, staleReasons: [] }),
    train: vi.fn(),
  },
}));

function makeItem(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chatbotId: chatbot.id,
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

function makeHighlightDetail(overrides: Partial<UnansweredQuestionDetail> = {}): UnansweredQuestionDetail {
  return {
    ...makeItem({ id: HIGHLIGHT_ID, questionText: HIGHLIGHT_TEXT }),
    variants: [HIGHLIGHT_TEXT],
    trend: [],
    trendApproximated: false,
    ...overrides,
  };
}

/**
 * 하이라이트 카드는 `role="status"`로 렌더되는데, 성공 토스트(`Toast`)도 같은 role을 쓴다.
 * 역할(role) 쿼리는 둘을 구별하지 못하므로 카드 고유 클래스로 스코프한다(M-1 회귀 테스트 전용 헬퍼).
 */
function getHighlightCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector('.learning-highlight-card');
  if (!card) throw new Error('하이라이트 카드(.learning-highlight-card)를 찾을 수 없습니다.');
  return card as HTMLElement;
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/stats/learning?highlightId=${HIGHLIGHT_ID}`]}>
      <ToastProvider>
        <LearningQueuePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * L1 하이라이트 카드(M-1 code-reviewer 수정사항) 전용 회귀 테스트.
 * `LearningQueuePage.tsx`의 `refreshHighlightIfMatch`/하이라이트 카드 분기(§4.7, F-14, AC-UI-8)를 다룬다.
 */
describe('LearningQueuePage — highlightId 하이라이트 카드(M-1)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockFindOne.mockReset();
    mockIgnore.mockReset();
    mockReopen.mockReset();
    canWrite = true;
  });

  it('하이라이트 대상이 현재 필터 목록에 이미 있으면 하이라이트 카드를 렌더하지 않는다(중복 표시 방지)', async () => {
    // 목록에 highlightId와 같은 항목이 포함된 경우 — 기본 필터(PENDING)에 이미 보이는 상황.
    mockList.mockResolvedValue({ items: [makeItem({ id: HIGHLIGHT_ID, questionText: HIGHLIGHT_TEXT })], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeHighlightDetail());

    const { container } = renderPage();
    await screen.findByText(HIGHLIGHT_TEXT); // 표 안의 행으로 렌더된다.

    // 하이라이트 카드 전용 안내 문구·카드 자체는 나타나지 않는다.
    expect(screen.queryByText('다른 필터 조건의 항목입니다.')).not.toBeInTheDocument();
    expect(container.querySelector('.learning-highlight-card')).not.toBeInTheDocument();
  });

  it('하이라이트 대상이 현재 필터 목록에 없으면 하이라이트 카드가 액션과 함께 렌더된다(EDITOR)', async () => {
    // 목록은 비워 표의 "반영/무시" 버튼과 카드의 버튼이 쿼리에서 겹치지 않게 한다.
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeHighlightDetail());

    const { container } = renderPage();
    await screen.findByText('다른 필터 조건의 항목입니다.');

    const card = getHighlightCard(container);
    expect(within(card).getByText(HIGHLIGHT_TEXT)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '반영' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '무시' })).toBeInTheDocument();
    // PENDING 상태이므로 되돌리기는 없다.
    expect(within(card).queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument();
  });

  it('하이라이트 대상이 PENDING이 아니면(RESOLVED) 되돌리기만 렌더되고 반영/무시는 없다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeHighlightDetail({ status: 'RESOLVED' }));

    const { container } = renderPage();
    await screen.findByText('다른 필터 조건의 항목입니다.');

    const card = getHighlightCard(container);
    expect(within(card).getByRole('button', { name: '되돌리기' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '무시' })).not.toBeInTheDocument();
  });

  it('VIEWER(쓰기 권한 없음)는 하이라이트 카드는 보이되 액션 버튼은 렌더되지 않는다(FR-C-6)', async () => {
    canWrite = false;
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeHighlightDetail());

    const { container } = renderPage();
    await screen.findByText('다른 필터 조건의 항목입니다.');

    const card = getHighlightCard(container);
    expect(within(card).queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '무시' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument();
  });

  it('하이라이트 카드에서 무시를 누르면 카드 상세가 재조회되어 상태가 갱신된다(refreshHighlightIfMatch)', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockFindOne
      .mockResolvedValueOnce(makeHighlightDetail()) // 최초 로드(PENDING)
      .mockResolvedValueOnce(makeHighlightDetail({ status: 'IGNORED' })); // 무시 후 재조회
    mockIgnore.mockResolvedValue(makeItem({ id: HIGHLIGHT_ID, status: 'IGNORED' }));

    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByText('다른 필터 조건의 항목입니다.');

    await user.click(within(getHighlightCard(container)).getByRole('button', { name: '무시' }));

    await waitFor(() => expect(mockIgnore).toHaveBeenCalledWith(chatbot.id, HIGHLIGHT_ID));
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledTimes(2));
    // 재조회 후 카드가 IGNORED로 갱신되어 되돌리기만 남는다.
    await waitFor(() => expect(within(getHighlightCard(container)).getByRole('button', { name: '되돌리기' })).toBeInTheDocument());
  });

  it('highlightId가 없으면 하이라이트 카드 자체가 렌더되지 않는다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/stats/learning`]}>
        <ToastProvider>
          <LearningQueuePage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('검토할 미응답 질문이 없습니다 — 좋은 신호입니다.');

    expect(mockFindOne).not.toHaveBeenCalled();
    expect(container.querySelector('.learning-highlight-card')).not.toBeInTheDocument();
  });
});
