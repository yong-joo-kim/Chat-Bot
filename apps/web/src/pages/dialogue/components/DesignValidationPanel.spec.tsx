import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DesignIssue, DesignValidationReport } from '@chat-bot/shared-types';
import { DesignValidationPanel } from './DesignValidationPanel';

function baseReport(overrides: Partial<DesignValidationReport> = {}): DesignValidationReport {
  return {
    issues: [],
    summary: { error: 0, warning: 0, info: 0 },
    checkedAt: new Date('2026-09-25T10:02:00.000Z'),
    ...overrides,
  };
}

function renderPanel(report: DesignValidationReport) {
  return render(
    <MemoryRouter>
      <DesignValidationPanel chatbotId="bot-1" report={report} loading={false} error={false} onRetry={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

/** [코드 리뷰 1회차 M-3/M-4] 토픽 규칙 4종의 링크 라벨·문구 구성·"외 N건" 안내. */
describe('DesignValidationPanel — 토픽 규칙(M-3/M-4)', () => {
  it('resourceType이 CHATBOT이면 링크 라벨이 "토픽 관리로 이동"이고 /topics로 이동한다', () => {
    const issue: DesignIssue = {
      code: 'NO_LIVE_ENTRY_POINT',
      severity: 'WARNING',
      resourceType: 'CHATBOT',
      message: '토픽이 있지만 활성 응답 진입점이 0건입니다',
    };
    renderPanel(baseReport({ issues: [issue], summary: { error: 0, warning: 1, info: 0 } }));

    const link = screen.getByRole('link', { name: '토픽 관리로 이동' });
    expect(link).toHaveAttribute('href', '/chatbots/bot-1/dialogue/topics');
  });

  it('INACTIVE_TOPIC_REFERENCE는 topicRef로부터 구조화된 문구를 만든다(서버 message에만 의존하지 않는다)', () => {
    const issue: DesignIssue = {
      code: 'INACTIVE_TOPIC_REFERENCE',
      severity: 'WARNING',
      resourceType: 'NODE',
      resourceId: 'node-1',
      resourceName: '배송조회_응답',
      message: '(서버 원문 — 검증 대상 아님)',
      topicRef: {
        edge: 'NODE_MOVE',
        sourceTopicName: '배송',
        targetResourceType: 'NODE',
        targetResourceId: 'node-2',
        targetResourceName: '보험접수_안내',
        targetTopicId: 'topic-2',
        targetTopicName: '보험청구',
      },
    };
    renderPanel(baseReport({ issues: [issue], summary: { error: 0, warning: 1, info: 0 } }));

    expect(screen.getByText('비활성 토픽 참조 — 배송조회_응답(배송) → 보험접수_안내(보험청구·비활성)')).toBeInTheDocument();
  });

  it('ruleTotals가 표시된 건수보다 크면 "외 N건" 안내를 규칙별로 보여준다(EX-TP-23)', () => {
    const issues: DesignIssue[] = [
      {
        code: 'CROSS_TOPIC_REFERENCE',
        severity: 'INFO',
        resourceType: 'NODE',
        resourceId: 'node-1',
        resourceName: '노드1',
        message: '(서버 원문)',
        topicRef: {
          edge: 'NODE_MOVE',
          sourceTopicName: '배송',
          targetResourceType: 'INTENT',
          targetResourceId: 'intent-1',
          targetResourceName: '환불',
          targetTopicId: null,
          targetTopicName: '공통',
        },
      },
    ];
    renderPanel(
      baseReport({
        issues,
        summary: { error: 0, warning: 0, info: 1 },
        ruleTotals: { CROSS_TOPIC_REFERENCE: 62 },
      }),
    );

    expect(screen.getByText('교차 토픽 참조 외 61건')).toBeInTheDocument();
  });

  it('ruleTotals가 표시된 건수와 같으면(잘리지 않음) "외 N건" 안내를 보여주지 않는다', () => {
    const issues: DesignIssue[] = [
      {
        code: 'NO_LIVE_ENTRY_POINT',
        severity: 'WARNING',
        resourceType: 'CHATBOT',
        message: '토픽이 있지만 활성 응답 진입점이 0건입니다',
      },
    ];
    renderPanel(baseReport({ issues, summary: { error: 0, warning: 1, info: 0 }, ruleTotals: { NO_LIVE_ENTRY_POINT: 1 } }));

    expect(screen.queryByText(/외 \d+건/)).not.toBeInTheDocument();
  });
});
