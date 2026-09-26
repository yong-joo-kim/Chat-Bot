import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowTarget } from '@chat-bot/shared-types';
import { WorkflowTargetEditModal } from './WorkflowTargetEditModal';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockTest = vi.fn();

vi.mock('../../../api/workflowTargets', () => ({
  workflowTargetsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    test: (...args: unknown[]) => mockTest(...args),
  },
}));

function makeTarget(overrides: Partial<WorkflowTarget> = {}): WorkflowTarget {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '그룹웨어 결재 흐름',
    description: null,
    baseUrl: 'https://flow.corp.internal/hooks/abc',
    baseUrlHost: 'flow.corp.internal',
    authType: 'NONE',
    authHeaderName: null,
    secretRef: null,
    signingEnabled: true,
    signingSecretRef: 'GW_SIGN',
    urlSecretRef: null,
    timeoutMs: 5000,
    maxAttempts: 5,
    allowRawPersonalData: false,
    enabled: true,
    pausedAt: null,
    secretStates: { auth: 'NOT_REQUIRED', signing: 'CONFIGURED', url: 'NOT_REQUIRED', signingWeak: false },
    insecureHttp: false,
    egressDecision: 'ALLOWED',
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    referencingNodeCount: 0,
    subscriptionCount: 0,
    stats24h: { succeeded: 0, failed: 0 },
    pendingCount: 0,
    heldCount: 0,
    failedRetainedCount: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

/** WF1 — 대상 편집 모달(ui-spec §3.1.1). 원문 허용 확인 흐름 + 테스트 발송 결과. */
describe('WorkflowTargetEditModal', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockTest.mockReset();
  });

  it('원문 개인정보 전송 허용을 켜면 확인 필드가 나타나고, 이름과 다르면 저장이 막힌다', async () => {
    render(<WorkflowTargetEditModal isOpen target={makeTarget()} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('원문 개인정보 전송 허용(기본: 가려서 전송)'));
    const confirmInput = await screen.findByLabelText('원문 전송을 켜려면 대상 이름을 다시 입력하세요');
    fireEvent.change(confirmInput, { target: { value: '다른이름' } });

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(screen.getByText('입력한 이름이 대상 이름과 일치하지 않습니다.')).toBeInTheDocument();

    fireEvent.change(confirmInput, { target: { value: '그룹웨어 결재 흐름' } });
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
  });

  it('CONFIRM_NAME_MISMATCH 응답이면 인라인 오류로 매핑한다', async () => {
    const { ApiError } = await import('../../../api/client');
    mockUpdate.mockRejectedValue(new ApiError(400, '이름 불일치', 'CONFIRM_NAME_MISMATCH'));

    render(<WorkflowTargetEditModal isOpen target={makeTarget()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('원문 개인정보 전송 허용(기본: 가려서 전송)'));
    const confirmInput = await screen.findByLabelText('원문 전송을 켜려면 대상 이름을 다시 입력하세요');
    fireEvent.change(confirmInput, { target: { value: '그룹웨어 결재 흐름' } });

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(await screen.findByText('입력한 이름이 대상 이름과 일치하지 않습니다.')).toBeInTheDocument();
  });

  it('테스트 발송 결과는 서버 guidance 문자열을 그대로 보여준다(코드별 재구현 없음)', async () => {
    mockTest.mockResolvedValue({
      runId: '22222222-2222-4222-8222-222222222222',
      outcome: 'BLOCKED_ADDRESS',
      latencyMs: 5,
      attempted: false,
      targetDisabled: false,
      targetPaused: false,
      guidance: '사설 주소(10.20.1.5)는 서버 허용 목록에 없어 전송할 수 없습니다. 운영자에게 허용 목록 추가를 요청하세요.',
    });

    render(<WorkflowTargetEditModal isOpen target={makeTarget()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '테스트 발송' }));

    expect(
      await screen.findByText('사설 주소(10.20.1.5)는 서버 허용 목록에 없어 전송할 수 없습니다. 운영자에게 허용 목록 추가를 요청하세요.'),
    ).toBeInTheDocument();
  });

  it('테스트 발송 성공 결과는 상태코드·지연만 보여주고 응답 본문은 표시하지 않는다', async () => {
    mockTest.mockResolvedValue({
      runId: '22222222-2222-4222-8222-222222222222',
      outcome: 'SUCCESS',
      httpStatus: 202,
      latencyMs: 412,
      attempted: true,
      targetDisabled: false,
      targetPaused: false,
      guidance: '',
    });

    render(<WorkflowTargetEditModal isOpen target={makeTarget()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '테스트 발송' }));

    expect(await screen.findByText(/202 · 412ms · 실제로 전송했습니다/)).toBeInTheDocument();
  });
});
