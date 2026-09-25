import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UnansweredQuestionListItem, UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { ToastProvider } from '../components/Toast';
import { UnsavedGuardProvider } from '../context/UnsavedGuardContext';
import { makeChatbot, makeDeployScheduleMeta } from '../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../lib/useDeployScheduleMeta';
import { ChatbotDetailLayout } from './ChatbotDetailLayout';
import { StatsShell } from './stats/StatsShell';
import { LearningQueuePage } from './learning/LearningQueuePage';

expect.extend(toHaveNoViolations);

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333', status: 'ACTIVE' });

const mockFindOne = vi.fn();
vi.mock('../api/chatbots', () => ({
  chatbotsApi: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateStatus: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock('../api/groups', () => ({
  groupsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
}));

const mockDeployScheduleSummary = vi.fn();
const mockDeployScheduleMeta = vi.fn();
vi.mock('../api/deploySchedules', () => ({
  deploySchedulesApi: {
    summary: (...args: unknown[]) => mockDeployScheduleSummary(...args),
    meta: (...args: unknown[]) => mockDeployScheduleMeta(...args),
  },
}));

const mockLearningSummary = vi.fn();
const mockLearningList = vi.fn();
const mockLearningIgnore = vi.fn();
vi.mock('../api/learning', () => ({
  learningApi: {
    summary: (...args: unknown[]) => mockLearningSummary(...args),
    list: (...args: unknown[]) => mockLearningList(...args),
    findOne: vi.fn(),
    resolve: vi.fn(),
    ignore: (...args: unknown[]) => mockLearningIgnore(...args),
    reopen: vi.fn(),
    bulkResolve: vi.fn(),
    bulkIgnore: vi.fn(),
    markAddressed: vi.fn(),
  },
}));

vi.mock('../api/dialogue', () => ({
  intentsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
  keywordsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
}));

vi.mock('../api/classifier', () => ({
  classifierApi: {
    status: vi.fn().mockResolvedValue({ state: 'NONE', classCount: 0, sampleCount: 0, stale: false, staleReasons: [] }),
    train: vi.fn(),
  },
}));

// 실제 `AuthContext.can`은 세션 동안 안정적인 참조다 — 목도 같은 성질을 유지해 `refreshLearningSummary`
// 의존성(`canReadDialogue`)이 불필요하게 재계산되지 않게 한다. 시험별로 `permissions`만 바꾼다.
let permissions = new Set([
  'chatbot:read',
  'chatbot:write',
  'dialogue:read',
  'dialogue:write',
  'channel:read',
  'channel:write',
]);
const can = (p: string): boolean => permissions.has(p);
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ can }),
}));

function makeSummary(overrides: Partial<{ unanswered: number; negativeFeedback: number }> = {}): UnansweredQuestionSummary {
  return {
    pendingCount: 999, // 두 소스 합계 — 어느 배지도 이 값을 그대로 쓰면 회귀다.
    limitReached: false,
    bySource: {
      UNANSWERED: { pendingCount: overrides.unanswered ?? 0, limitReached: false },
      NEGATIVE_FEEDBACK: { pendingCount: overrides.negativeFeedback ?? 0, limitReached: false },
    },
  };
}

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
    source: 'UNANSWERED',
    ...overrides,
  };
}

function renderTree(initialPath: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <UnsavedGuardProvider>
          <Routes>
            <Route path="/chatbots/:chatbotId" element={<ChatbotDetailLayout />}>
              <Route path="dashboard" element={<div>대시보드 스텁</div>} />
              <Route path="stats" element={<StatsShell />}>
                <Route path="learning" element={<LearningQueuePage />} />
              </Route>
            </Route>
          </Routes>
        </UnsavedGuardProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * No.44 R2(Medium) — `TabNav`(탭 배지)와 `StatsShell`(서브내비 배지)이 각자 `learningApi.summary()`를
 * 호출해 통계 탭 진입 시 요청이 2번 나갔고, 두 상태가 분리돼 있어 `LearningQueuePage`에서
 * 반영/무시/되돌리기·일괄처리를 해도 `TabNav` "통계" 배지만 옛 값으로 남는 결함이 있었다.
 * `ChatbotDetailLayout`(공통 부모)로 상태를 끌어올린 뒤에도 같은 동작(1회 조회, 액션 뒤 동기화,
 * 권한 가드)이 유지되는지 검증한다.
 */
describe('ChatbotDetailLayout — 학습현황 요약 단일화(No.44 R2)', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockDeployScheduleSummary.mockReset();
    mockDeployScheduleMeta.mockReset();
    mockLearningSummary.mockReset();
    mockLearningList.mockReset();
    mockLearningIgnore.mockReset();
    resetDeployScheduleMetaCacheForTests();
    permissions = new Set(['chatbot:read', 'chatbot:write', 'dialogue:read', 'dialogue:write', 'channel:read', 'channel:write']);

    mockFindOne.mockResolvedValue(chatbot);
    mockDeployScheduleSummary.mockResolvedValue({ needsAttention: { byChatbot: [] } });
    mockDeployScheduleMeta.mockResolvedValue(makeDeployScheduleMeta());
    mockLearningList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('(a) TabNav·StatsShell·LearningQueuePage를 한 트리(Layout 포함)로 렌더해도 요약 API는 정확히 1회 호출된다', async () => {
    mockLearningSummary.mockResolvedValue(makeSummary({ unanswered: 3, negativeFeedback: 2 }));

    renderTree(`/chatbots/${chatbot.id}/stats/learning`);

    const tabNav = await screen.findByRole('navigation', { name: '챗봇 상세 탭' });
    await within(tabNav).findByLabelText('대기 중인 미응답 질문 3건');
    within(tabNav).getByLabelText('대기 중인 부정 평가 2건');

    const subNav = screen.getByRole('navigation', { name: '통계 메뉴' });
    within(subNav).getByLabelText('대기 중인 미응답 질문 3건');
    within(subNav).getByLabelText('대기 중인 부정 평가 2건');

    // 합계(999)가 그대로 보이는 곳은 없어야 한다.
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();

    await waitFor(() => expect(mockLearningSummary).toHaveBeenCalledTimes(1));
    expect(mockLearningSummary).toHaveBeenCalledWith(chatbot.id);
  });

  it('(b) 무시(refreshLearningSummary 호출) 뒤 TabNav 배지와 StatsSubNav 배지가 함께 새 값으로 갱신된다', async () => {
    const user = userEvent.setup();
    mockLearningSummary.mockResolvedValueOnce(makeSummary({ unanswered: 2, negativeFeedback: 1 })).mockResolvedValueOnce(makeSummary({ unanswered: 1, negativeFeedback: 1 }));
    mockLearningList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockLearningIgnore.mockResolvedValue(undefined);

    renderTree(`/chatbots/${chatbot.id}/stats/learning`);

    const tabNav = await screen.findByRole('navigation', { name: '챗봇 상세 탭' });
    const subNav = screen.getByRole('navigation', { name: '통계 메뉴' });
    await within(tabNav).findByLabelText('대기 중인 미응답 질문 2건');
    within(subNav).getByLabelText('대기 중인 미응답 질문 2건');

    await screen.findByText('해외배송도 되나요?');
    await user.click(screen.getByRole('button', { name: '무시' }));

    await waitFor(() => expect(mockLearningIgnore).toHaveBeenCalledWith(chatbot.id, makeItem().id));
    await waitFor(() => expect(mockLearningSummary).toHaveBeenCalledTimes(2));

    // 두 배지 모두 새 값(1건)으로 함께 갱신되고, 옛 값(2건)은 더는 남아있지 않다.
    await within(tabNav).findByLabelText('대기 중인 미응답 질문 1건');
    within(subNav).getByLabelText('대기 중인 미응답 질문 1건');
    expect(screen.queryByLabelText('대기 중인 미응답 질문 2건')).not.toBeInTheDocument();
  });

  it('(c) dialogue:read 권한이 없으면 학습현황 요약 API를 전혀 호출하지 않는다', async () => {
    permissions = new Set(['chatbot:read', 'chatbot:write', 'channel:read', 'channel:write']);

    renderTree(`/chatbots/${chatbot.id}/dashboard`);

    await screen.findByText('대시보드 스텁');
    expect(mockLearningSummary).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/대기 중인/)).not.toBeInTheDocument();
  });

  it('(d) TabNav + StatsShell + LearningQueuePage가 함께 렌더된 화면에 구조적 접근성 위반이 없다', async () => {
    mockLearningSummary.mockResolvedValue(makeSummary({ unanswered: 3, negativeFeedback: 2 }));
    mockLearningList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });

    const { container } = renderTree(`/chatbots/${chatbot.id}/stats/learning`);

    await screen.findByText('해외배송도 되나요?');
    // 같은 배지가 TabNav·StatsSubNav 두 곳에 렌더되므로(검증 의도) `findAllBy`로 스코프한다.
    await screen.findAllByLabelText('대기 중인 부정 평가 2건');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  /**
   * [test-automation No.44 자동시험 — 결함 발견 및 수정] 챗봇 상세를 열어둔 채(같은
   * `ChatbotDetailLayout` 인스턴스가 재사용되는 상황 — 예: 목록에서 다른 챗봇 상세로 바로 이동)
   * chatbotId가 바뀌면, 새 챗봇의 학습현황 응답이 도착하기 전까지 TabNav 배지가 직전 챗봇(A)의
   * 값을 그대로 보여주던 결함이 있었다. `ChatbotDetailLayout`이 chatbotId 변경 시
   * `learningSummary`를 즉시 null로 비우도록 최소 수정했다 — 이 시험은 그 수정 없이는 실패한다.
   */
  it('(e) chatbotId가 바뀌면 새 응답이 오기 전까지 이전 챗봇의 배지 값이 남지 않는다', async () => {
    const user = userEvent.setup();
    const chatbotB = makeChatbot({ id: '44444444-4444-4444-8444-444444444444', status: 'ACTIVE', name: 'B봇' });

    mockFindOne.mockImplementation((id: string) => Promise.resolve(id === chatbotB.id ? chatbotB : chatbot));

    let resolveSummaryB!: (v: UnansweredQuestionSummary) => void;
    const summaryBPromise = new Promise<UnansweredQuestionSummary>((resolve) => {
      resolveSummaryB = resolve;
    });
    mockLearningSummary
      .mockResolvedValueOnce(makeSummary({ unanswered: 5, negativeFeedback: 0 }))
      .mockImplementationOnce(() => summaryBPromise);

    render(
      <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/dashboard`]}>
        <ToastProvider>
          <UnsavedGuardProvider>
            <Routes>
              <Route path="/chatbots/:chatbotId" element={<ChatbotDetailLayout />}>
                <Route
                  path="dashboard"
                  element={
                    <div>
                      대시보드 스텁
                      <Link to={`/chatbots/${chatbotB.id}/dashboard`}>다른 챗봇으로 이동</Link>
                    </div>
                  }
                />
              </Route>
            </Routes>
          </UnsavedGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    const tabNav = await screen.findByRole('navigation', { name: '챗봇 상세 탭' });
    await within(tabNav).findByLabelText('대기 중인 미응답 질문 5건');

    await user.click(screen.getByRole('link', { name: '다른 챗봇으로 이동' }));

    // 새 챗봇(B) 로드는 끝났지만(로딩 화면이 사라짐) 학습현황 요약 응답은 아직 오지 않은 시점.
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledWith(chatbotB.id));
    const tabNavAfterNav = await screen.findByRole('navigation', { name: '챗봇 상세 탭' });

    // 이전 챗봇(A)의 "5건" 배지가 남아있으면 결함이다 — B의 응답은 아직 오지 않았다.
    expect(within(tabNavAfterNav).queryByLabelText('대기 중인 미응답 질문 5건')).not.toBeInTheDocument();

    resolveSummaryB(makeSummary({ unanswered: 1, negativeFeedback: 0 }));
    await within(tabNavAfterNav).findByLabelText('대기 중인 미응답 질문 1건');
  });
});
