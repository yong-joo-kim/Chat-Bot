import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { ApiError } from '../../api/client';
import { makeChatbot } from '../../test/fixtures';
import { makeCapability } from '../chatbot-detail/utterance-analysis/testFixtures';
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

// [No.21] 서브내비 4번째 링크(발화 묶음 분석)는 권한·기능 켜짐(capability)에 따라 달라지므로 둘 다 바꿀 수 있게 했다.
let mockCan: (permission: string) => boolean = () => true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: (permission: string) => mockCan(permission) }),
}));

const mockCapability = vi.fn();
vi.mock('../../api/utteranceAnalyses', () => ({
  utteranceAnalysesApi: { capability: (...args: unknown[]) => mockCapability(...args) },
}));

beforeEach(() => {
  mockCan = () => true;
  mockCapability.mockReset();
  mockCapability.mockResolvedValue(makeCapability());
});

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

/** [No.21] deep-clustering-ui-spec.md §1.2 — 통계 서브내비 4번째 항목 "발화 묶음 분석". */
describe('StatsShell — 발화 묶음 분석 서브내비 링크(No.21)', () => {
  it('기능이 켜져 있고 dialogue:read 권한이 있으면 4번째 링크로 보인다', async () => {
    renderShell(null);

    const link = await screen.findByRole('link', { name: '발화 묶음 분석' });
    expect(link).toHaveAttribute('href', `/chatbots/${chatbot.id}/stats/utterance-analyses`);
    const labels = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    expect(labels).toEqual(['기본 통계', '학습현황', '외부 연동 로그', '발화 묶음 분석']);
  });

  it('capability가 404(기능 꺼짐)이면 링크를 숨기고 나머지 링크는 그대로다', async () => {
    mockCapability.mockRejectedValue(new ApiError(404, 'Not Found'));
    renderShell(null);

    await waitFor(() => expect(mockCapability).toHaveBeenCalled());
    await screen.findByText('학습현황');
    expect(screen.queryByRole('link', { name: '발화 묶음 분석' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('404가 아닌 조회 실패는 링크를 숨기지 않는다(페이지에서 오류를 처리)', async () => {
    mockCapability.mockRejectedValue(new ApiError(500, 'Server Error'));
    renderShell(null);

    expect(await screen.findByRole('link', { name: '발화 묶음 분석' })).toBeInTheDocument();
  });

  it('dialogue:read 권한이 없으면 링크를 그리지 않고 capability도 조회하지 않는다', async () => {
    mockCan = (permission) => permission !== 'dialogue:read';
    renderShell(null);

    await screen.findByText('기본 통계');
    expect(screen.queryByRole('link', { name: '발화 묶음 분석' })).not.toBeInTheDocument();
    expect(mockCapability).not.toHaveBeenCalled();
  });
});
