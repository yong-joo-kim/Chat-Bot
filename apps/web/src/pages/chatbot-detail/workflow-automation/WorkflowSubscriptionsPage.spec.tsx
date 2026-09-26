import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { WorkflowSubscription } from '@chat-bot/shared-types';
import { makeChatbot } from '../../../test/fixtures';
import { ToastProvider } from '../../../components/Toast';
import { WorkflowSubscriptionsPage } from './WorkflowSubscriptionsPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../api/workflowSubscriptions', () => ({
  workflowSubscriptionsApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
}));
vi.mock('../../../api/workflowTargets', () => ({
  workflowTargetsApi: {
    picker: vi.fn().mockResolvedValue({
      items: [{ id: 't1', name: '팀 메신저 봇', enabled: true, paused: false, ready: true, allowRawPersonalData: false }],
    }),
  },
}));
let mockWorkflowAttention: { count: number; featureEnabled: boolean } | null = null;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({ chatbot: makeChatbot(), workflowAttention: mockWorkflowAttention }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeSub(overrides: Partial<WorkflowSubscription> = {}): WorkflowSubscription {
  return {
    id: 'sub-1',
    chatbotId: makeChatbot().id,
    eventType: 'HANDOFF_ENDED',
    targetId: 't1',
    targetName: '팀 메신저 봇',
    targetEnabled: true,
    targetPaused: false,
    enabled: true,
    pausedAt: null,
    conditions: {},
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

/** WF3 — 챗봇 > 업무 자동화 > 이벤트 구독(workflow-automation-ui-spec.md §3.5). */
describe('WorkflowSubscriptionsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockWorkflowAttention = null;
  });

  it('WORKFLOW_ENABLED=false(featureEnabled:false)면 상시 배너를 보여준다(추가 호출 없이 탭 배지 조회를 재사용)', async () => {
    mockList.mockResolvedValue({ items: [] });
    mockWorkflowAttention = { count: 0, featureEnabled: false };

    render(
      <ToastProvider>
        <WorkflowSubscriptionsPage />
      </ToastProvider>,
    );

    expect(
      await screen.findByText('서버 설정으로 업무 자동화 기능이 꺼져 있습니다 — 등록·수정은 가능하지만 발송되지 않습니다.'),
    ).toBeInTheDocument();
  });

  it('featureEnabled 조회 전(null)이거나 true면 배너가 보이지 않는다', async () => {
    mockList.mockResolvedValue({ items: [] });
    render(
      <ToastProvider>
        <WorkflowSubscriptionsPage />
      </ToastProvider>,
    );
    await screen.findByText('연속 미응답 N회');
    expect(screen.queryByText(/서버 설정으로 업무 자동화 기능이 꺼져 있습니다/)).not.toBeInTheDocument();
  });

  it('이벤트 5종 고정 행 + 환경 분리 안내를 렌더하고 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeSub()] });
    const { container } = render(
      <ToastProvider>
        <WorkflowSubscriptionsPage />
      </ToastProvider>,
    );

    await screen.findByText(/저장 즉시 운영에 적용됩니다/);
    expect(screen.getByText('상담 시작')).toBeInTheDocument();
    expect(screen.getByText('상담 종료')).toBeInTheDocument();
    expect(screen.getByText('설문 완료')).toBeInTheDocument();
    expect(screen.getByText('부정 평가')).toBeInTheDocument();
    expect(screen.getByText('연속 미응답 N회')).toBeInTheDocument();

    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });

  it('연속 미응답 행에는 임계값(2~10) 숫자 입력이 있다', async () => {
    mockList.mockResolvedValue({ items: [] });
    render(
      <ToastProvider>
        <WorkflowSubscriptionsPage />
      </ToastProvider>,
    );
    await screen.findByText('연속 미응답 N회');

    const thresholdInputs = screen.getAllByLabelText('임계값');
    expect(thresholdInputs.length).toBeGreaterThan(0);
    expect(thresholdInputs[0]).toHaveAttribute('min', '2');
    expect(thresholdInputs[0]).toHaveAttribute('max', '10');
  });
});
