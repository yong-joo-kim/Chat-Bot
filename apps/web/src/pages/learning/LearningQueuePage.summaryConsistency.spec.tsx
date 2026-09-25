import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { StatsShell } from '../stats/StatsShell';
import { LearningQueuePage } from './LearningQueuePage';

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });

function makeSummary(overrides: Partial<UnansweredQuestionSummary> = {}): UnansweredQuestionSummary {
  return {
    pendingCount: 999, // 두 소스 합계 — 어느 배지/탭도 이 값을 그대로 쓰면 회귀다.
    limitReached: false,
    bySource: {
      UNANSWERED: { pendingCount: 1, limitReached: false },
      NEGATIVE_FEEDBACK: { pendingCount: 2, limitReached: false },
    },
    ...overrides,
  };
}

// [No.44 R2] `learningSummary`는 이제 `ChatbotDetailLayout`이 챗봇 상세 마운트당 1회만 조회해
// 내려주는 단일 값이다 — `StatsShell`은 더 이상 자체적으로 `learningApi.summary()`를 호출하지
// 않는다. "요약 API는 1회만 호출된다"는 회귀 시험은 실제 `ChatbotDetailLayout`을 함께 렌더하는
// `../ChatbotDetailLayout.learningSummary.spec.tsx`에서 검증한다 — 이 스펙은 하나의 컨텍스트
// 값에서 `SourceTabStrip`(L1)과 `NegativeFeedbackNavBadge`(StatsSubNav)가 서로 다른 숫자를
// 보여주지 않는지만 검증한다.
let mockContext: ChatbotDetailContext;

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

// 실제 `AuthContext.can`은 `useCallback([user])`로 메모이즈된 안정적 참조다(같은 세션 동안 재생성되지
// 않음) — 목도 같은 성질을 유지한다.
const stableCan = (): boolean => true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: stableCan }),
}));

const mockList = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    summary: vi.fn(),
    list: (...args: unknown[]) => mockList(...args),
    findOne: vi.fn(),
    resolve: vi.fn(),
    ignore: vi.fn(),
    reopen: vi.fn(),
    bulkResolve: vi.fn(),
    bulkIgnore: vi.fn(),
    markAddressed: vi.fn(),
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

vi.mock('../../api/classifier', () => ({
  classifierApi: {
    status: vi.fn().mockResolvedValue({ state: 'NONE', classCount: 0, sampleCount: 0, stale: false, staleReasons: [] }),
    train: vi.fn(),
  },
}));

function renderShellWithLearningPage(learningSummary: UnansweredQuestionSummary): ReturnType<typeof render> {
  mockContext = {
    chatbot,
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard: vi.fn(),
    learningSummary,
    refreshLearningSummary: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/stats/learning`]}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/stats" element={<StatsShell />}>
            <Route path="learning" element={<LearningQueuePage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * No.44 R1(Low)/R2 — `SourceTabStrip`(L1, `LearningQueuePage`)과 `NegativeFeedbackNavBadge`(`StatsSubNav`,
 * `StatsShell`)는 같은 `learningSummary`(부모 `ChatbotDetailLayout`이 컨텍스트로 내려주는 단일 객체)에서
 * 값을 읽는다 — 두 표시가 서로 다른 소스에서 어긋난 값을 보여주지 않는지 검증한다.
 */
describe('SourceTabStrip · NegativeFeedbackNavBadge 값 일치(같은 summary 원본, No.44 R2)', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('부정 평가 2건 · 미응답 1건이면 SourceTabStrip 탭 라벨과 StatsSubNav 배지가 같은 숫자를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderShellWithLearningPage(makeSummary());

    // SourceTabStrip(L1) — bySource.NEGATIVE_FEEDBACK.pendingCount = 2.
    expect(await screen.findByRole('button', { name: '부정 평가 (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '답변 못함 (1)' })).toBeInTheDocument();

    // StatsSubNav(StatsShell) — 같은 summary의 같은 필드에서 나온 별도 배지.
    expect(screen.getByLabelText('대기 중인 부정 평가 2건')).toBeInTheDocument();
    expect(screen.getByLabelText('대기 중인 미응답 질문 1건')).toBeInTheDocument();

    // 합계(999)를 그대로 보여주는 표시는 어디에도 없어야 한다.
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });
});
