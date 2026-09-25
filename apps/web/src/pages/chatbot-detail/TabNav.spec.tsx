import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionSummary } from '@chat-bot/shared-types';
import { TabNav } from './TabNav';

expect.extend(toHaveNoViolations);

const CHATBOT_ID = '33333333-3333-4333-8333-333333333333';

const mockDeployScheduleSummary = vi.fn();
vi.mock('../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    summary: (...args: unknown[]) => mockDeployScheduleSummary(...args),
  },
}));

function makeLearningSummary(overrides: Partial<{ pendingCount: number; unanswered: number; negativeFeedback: number }> = {}): UnansweredQuestionSummary {
  return {
    pendingCount: overrides.pendingCount ?? 999, // 두 소스 합계 — 배지가 이 값을 쓰면 회귀다.
    limitReached: false,
    bySource: {
      UNANSWERED: { pendingCount: overrides.unanswered ?? 0, limitReached: false },
      NEGATIVE_FEEDBACK: { pendingCount: overrides.negativeFeedback ?? 0, limitReached: false },
    },
  };
}

function renderTabNav(learningSummary: UnansweredQuestionSummary | null): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${CHATBOT_ID}/dashboard`]}>
      <TabNav chatbotId={CHATBOT_ID} learningSummary={learningSummary} environmentStatus={null} />
    </MemoryRouter>,
  );
}

/**
 * No.44 R2 — TabNav "통계" 탭 배지(feedback-loop-ui-spec.md §3.5). 요약 조회는 더 이상 이 컴포넌트의
 * 책임이 아니다 — `ChatbotDetailLayout`이 챗봇 상세 마운트당 1회 조회해 `learningSummary` prop으로
 * 내려준다(중복 호출 제거, R2). `TabNav`는 그 값을 받아 `StatsSubNav`와 같은 판단(합계 `pendingCount`가
 * 아니라 `bySource`를 쓴다)으로 두 배지를 렌더하기만 한다. "요약 API 1회 호출/권한 가드/실패 시 생략"은
 * `../ChatbotDetailLayout.learningSummary.spec.tsx`에서 검증한다.
 */
describe('TabNav — "통계" 탭 부정 피드백/미응답 배지(No.44 R2)', () => {
  beforeEach(() => {
    mockDeployScheduleSummary.mockReset();
    mockDeployScheduleSummary.mockResolvedValue({ needsAttention: { byChatbot: [] } });
  });

  it('bySource 기준으로 두 배지를 따로 렌더한다(합계 아님)', async () => {
    renderTabNav(makeLearningSummary({ pendingCount: 5, unanswered: 3, negativeFeedback: 2 }));

    expect(await screen.findByLabelText('대기 중인 미응답 질문 3건')).toBeInTheDocument();
    expect(screen.getByLabelText('대기 중인 부정 평가 2건')).toBeInTheDocument();
    expect(screen.queryByLabelText('대기 중인 미응답 질문 5건')).not.toBeInTheDocument();
  });

  it('learningSummary가 null(조회 권한 없음/실패)이면 배지를 렌더하지 않는다', async () => {
    renderTabNav(null);

    await screen.findByText('통계');
    expect(screen.queryByLabelText(/대기 중인/)).not.toBeInTheDocument();
  });

  it('합계 pendingCount만 있고 두 소스가 모두 0이면 배지가 전혀 렌더되지 않는다', async () => {
    renderTabNav(makeLearningSummary({ pendingCount: 0, unanswered: 0, negativeFeedback: 0 }));

    await screen.findByText('통계');
    expect(screen.queryByLabelText(/대기 중인/)).not.toBeInTheDocument();
  });

  it('탭 내비게이션에 구조적 접근성 위반이 없다', async () => {
    const { container } = renderTabNav(makeLearningSummary({ pendingCount: 5, unanswered: 3, negativeFeedback: 2 }));

    await screen.findByLabelText('대기 중인 부정 평가 2건');
    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });
});

/** [신규 No.40] "배포" 그룹 4번째 탭 "환경"(§1.4). */
describe('TabNav — "환경" 탭(No.40)', () => {
  it('"배포" 그룹에 "환경" 탭이 렌더된다', async () => {
    render(
      <MemoryRouter initialEntries={[`/chatbots/${CHATBOT_ID}/dashboard`]}>
        <TabNav chatbotId={CHATBOT_ID} learningSummary={null} environmentStatus={null} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: /환경/ })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/environment`);
  });

  it('environmentStatus가 없으면(모드 꺼짐) 소형 점 표시가 렌더되지 않는다', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/chatbots/${CHATBOT_ID}/dashboard`]}>
        <TabNav chatbotId={CHATBOT_ID} learningSummary={null} environmentStatus={{ enabled: false, gate: null }} />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /환경/ });
    expect(container.querySelector('.environment-mode-indicator')).not.toBeInTheDocument();
  });

  it('environmentStatus.enabled=true면 소형 점 표시가 렌더된다(순수 장식, aria-hidden)', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/chatbots/${CHATBOT_ID}/dashboard`]}>
        <TabNav
          chatbotId={CHATBOT_ID}
          learningSummary={null}
          environmentStatus={
            {
              enabled: true,
              enabledAt: new Date(),
              prod: { versionId: 'v1', versionNo: 1, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
              staging: null,
              draft: { contentHash: 'a'.repeat(64), sameAsProd: true, sameAsStaging: true },
              gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
              activeSwitchSchedule: null,
            } as never
          }
        />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /환경/ });
    const indicator = container.querySelector('.environment-mode-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
  });
});
