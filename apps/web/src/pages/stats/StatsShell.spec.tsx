import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { StatsShell } from './StatsShell';

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });

function makeSummary(overrides: Partial<UnansweredQuestionSummary> = {}): UnansweredQuestionSummary {
  return {
    pendingCount: 999, // 두 소스 합계 — 배지가 이 값을 쓰면 회귀다.
    limitReached: false,
    bySource: {
      UNANSWERED: { pendingCount: 0, limitReached: false },
      NEGATIVE_FEEDBACK: { pendingCount: 0, limitReached: false },
    },
    ...overrides,
  };
}

// [No.44 R2] `learningSummary`/`refreshLearningSummary`는 더 이상 `StatsShell`이 직접 조회하지
// 않는다 — `ChatbotDetailLayout`(TabNav·StatsShell·LearningQueuePage의 공통 부모)이 챗봇 상세
// 마운트당 1회만 조회해 컨텍스트로 내려준다(중복 호출 제거 + 배지 값 동기화). 이 스펙은 그 값을
// 그대로 받았을 때 `StatsSubNav` 배지가 올바르게 렌더되는지만 검증한다. "1회 호출" 자체를 검증하는
// 회귀 시험은 `../ChatbotDetailLayout.learningSummary.spec.tsx`에 있다.
let mockContext: ChatbotDetailContext;

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function renderShell(learningSummary: UnansweredQuestionSummary | null): ReturnType<typeof render> {
  mockContext = {
    chatbot,
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard: vi.fn(),
    learningSummary,
    refreshLearningSummary: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/stats/overview`]}>
      <StatsShell />
    </MemoryRouter>,
  );
}

/**
 * No.44 FB-NAV — 기존 "미응답 대기" 배지는 두 소스 합계(`pendingCount`)가 아니라
 * `bySource.UNANSWERED.pendingCount`만 세야 한다(feedback-loop-ui-spec.md §3.5, PM 결정 §11).
 * 부정 평가는 별도 배지(`NegativeFeedbackNavBadge`)로만 표시된다.
 */
describe('StatsShell — 학습현황 탭 배지(No.44 소스 분리, R2: 부모 컨텍스트의 learningSummary 그대로 사용)', () => {
  it('미응답 3건 · 부정 평가 2건이면 두 배지가 각자의 값으로 따로 렌더된다(합계 5건 아님)', async () => {
    renderShell(
      makeSummary({
        pendingCount: 5,
        bySource: {
          UNANSWERED: { pendingCount: 3, limitReached: false },
          NEGATIVE_FEEDBACK: { pendingCount: 2, limitReached: false },
        },
      }),
    );

    expect(await screen.findByLabelText('대기 중인 미응답 질문 3건')).toBeInTheDocument();
    expect(screen.getByLabelText('대기 중인 부정 평가 2건')).toBeInTheDocument();
    // 합계(5)를 그대로 보여주는 배지는 없어야 한다.
    expect(screen.queryByLabelText('대기 중인 미응답 질문 5건')).not.toBeInTheDocument();
  });

  it('미응답 0건 · 부정 평가 2건이면 미응답 배지는 숨겨지고 부정 평가 배지만 보인다', async () => {
    renderShell(
      makeSummary({
        pendingCount: 2,
        bySource: {
          UNANSWERED: { pendingCount: 0, limitReached: false },
          NEGATIVE_FEEDBACK: { pendingCount: 2, limitReached: false },
        },
      }),
    );

    expect(await screen.findByLabelText('대기 중인 부정 평가 2건')).toBeInTheDocument();
    expect(screen.queryByLabelText(/대기 중인 미응답 질문/)).not.toBeInTheDocument();
  });

  it('두 소스 모두 0건이면 배지가 전혀 렌더되지 않는다', async () => {
    renderShell(makeSummary());

    await screen.findByText('학습현황');
    expect(screen.queryByLabelText(/대기 중인/)).not.toBeInTheDocument();
  });

  it('learningSummary가 null(조회 권한 없음/실패)이면 배지가 렌더되지 않는다', async () => {
    renderShell(null);

    await screen.findByText('학습현황');
    expect(screen.queryByLabelText(/대기 중인/)).not.toBeInTheDocument();
  });
});
