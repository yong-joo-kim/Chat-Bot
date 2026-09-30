import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GateEvaluation, ProdSwitchPreviewResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { ProdSwitchDialog } from './ProdSwitchDialog';

/** No.36 — 요청 모드 / 단독 롤백 모드(ai-guardrails-ui-spec.md §9.4). `approval` 키가 없으면 기존 동작(ProdSwitchDialog.spec.tsx 무수정)이다. */
const mockProdPreview = vi.fn();
const mockProdSwitch = vi.fn();
const mockProdRollback = vi.fn();
const mockCreateRequest = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    prodPreview: (...args: unknown[]) => mockProdPreview(...args),
    prodSwitch: (...args: unknown[]) => mockProdSwitch(...args),
    prodRollback: (...args: unknown[]) => mockProdRollback(...args),
  },
}));
vi.mock('../../../api/switchApprovals', () => ({
  switchApprovalsApi: { createRequest: (...args: unknown[]) => mockCreateRequest(...args) },
}));

const PASS_GATE: GateEvaluation = { verdict: 'PASS', reason: 'PASSED', run: { runId: 'run-1', setId: 'set-1', setName: '정기 회귀', passRate: 0.983, finishedAt: new Date('2026-09-25T04:50:00.000Z') } };

function preview(overrides: Partial<ProdSwitchPreviewResponse> = {}): ProdSwitchPreviewResponse {
  return {
    kind: 'SWITCH',
    current: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date('2026-09-20T00:00:00.000Z'), label: null },
    target: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date('2026-09-24T00:00:00.000Z'), label: null },
    expectedProdVersionId: 'ver-43',
    outcome: 'SWITCHABLE',
    diffSummary: { rows: [], totalChanged: 0, identical: false },
    gate: PASS_GATE,
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function renderDialog(kind: 'SWITCH' | 'ROLLBACK' = 'SWITCH', props: { onSwitched?: () => void; onRequested?: () => void; onClose?: () => void; approvalTtlHours?: number | null } = {}): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProdSwitchDialog
          chatbotId="bot-1"
          kind={kind}
          targetVersionId="ver-44"
          isOpen
          onClose={props.onClose ?? vi.fn()}
          onSwitched={props.onSwitched ?? vi.fn()}
          onRequested={props.onRequested}
          approvalTtlHours={props.approvalTtlHours}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockProdPreview.mockReset();
  mockProdSwitch.mockReset();
  mockProdRollback.mockReset();
  mockCreateRequest.mockReset();
});

describe('ProdSwitchDialog — 요청 모드(정책 켜짐)', () => {
  it('운영 전환은 제목·안내·확정 버튼이 "승인 요청"으로 바뀌고 승인 전까지 운영이 바뀌지 않는다고 알린다', async () => {
    mockProdPreview.mockResolvedValue(preview({ approval: { required: true } }));
    renderDialog('SWITCH', { approvalTtlHours: 24 });
    expect(await screen.findByRole('dialog', { name: '운영 전환 승인 요청' })).toBeInTheDocument();
    expect(screen.getByText(/다른 관리자의 승인이 필요합니다\. 요청을 보내면 승인될 때까지 운영은 바뀌지 않습니다\. 요청은 24시간 안에/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v44 승인 요청 보내기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'v44로 운영 전환' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-autofocus', 'cancel'));
  });

  it('유효 시간을 모르면 "정해진 시간 안에"로 표기한다', async () => {
    mockProdPreview.mockResolvedValue(preview({ approval: { required: true } }));
    renderDialog('SWITCH');
    expect(await screen.findByText(/요청은 정해진 시간 안에 승인되지 않으면 만료됩니다/)).toBeInTheDocument();
  });

  it('확정하면 승인 요청 API(PROD_SWITCH)를 부르고 사유·경고 확인을 함께 보낸 뒤 onRequested를 호출한다', async () => {
    const user = userEvent.setup();
    const onRequested = vi.fn();
    mockProdPreview.mockResolvedValue(preview({ approval: { required: true }, warnings: [{ code: 'LEGACY_TIEBREAK' }] as never }));
    mockCreateRequest.mockResolvedValue({ id: 'req-1' });
    renderDialog('SWITCH', { onRequested });
    await screen.findByRole('button', { name: 'v44 승인 요청 보내기' });
    await user.type(screen.getByLabelText('사유(선택)'), '10월 안내문 교체');
    // 경고 확인 없이는 요청하지 않는다(기존 규약).
    await user.click(screen.getByRole('button', { name: 'v44 승인 요청 보내기' }));
    expect(mockCreateRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'v44 승인 요청 보내기' }));
    await waitFor(() => expect(mockCreateRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateRequest).toHaveBeenCalledWith('bot-1', {
      action: 'PROD_SWITCH',
      targetVersionId: 'ver-44',
      expectedProdVersionId: 'ver-43',
      acknowledgeWarnings: true,
      reason: '10월 안내문 교체',
    });
    expect(mockProdSwitch).not.toHaveBeenCalled();
    await waitFor(() => expect(onRequested).toHaveBeenCalled());
  });

  it('직전 버전이 아닌 롤백은 "되돌리기 승인 요청" 모드다', async () => {
    mockProdPreview.mockResolvedValue(preview({ kind: 'ROLLBACK', approval: { required: true, soloRollbackAllowed: false } }));
    renderDialog('ROLLBACK');
    expect(await screen.findByRole('dialog', { name: '되돌리기 승인 요청' })).toBeInTheDocument();
    expect(screen.getByText(/직전 운영 버전이 아닌 버전으로 되돌리려면 다른 관리자의 승인이 필요합니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v44 되돌리기 승인 요청 보내기' })).toBeInTheDocument();
  });

  it('요청이 409(대기 요청 이미 있음)면 안내와 "대기 중인 요청 보기" 링크를 보인다', async () => {
    const user = userEvent.setup();
    mockProdPreview.mockResolvedValue(preview({ approval: { required: true } }));
    mockCreateRequest.mockRejectedValue(new ApiError(409, 'x', 'APPROVAL_PENDING_EXISTS' as never, [{ field: 'requestId', message: 'req-9' }]));
    renderDialog('SWITCH');
    await user.click(await screen.findByRole('button', { name: 'v44 승인 요청 보내기' }));
    expect(await screen.findByText(/승인을 기다리는 요청이 이미 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '대기 중인 요청 보기' })).toHaveAttribute('href', '/environment-approvals/bot-1/req-9');
  });

  it('게이트 차단이 있으면 확정 버튼 없이 확인 버튼만 둔다(요청도 만들 수 없다)', async () => {
    mockProdPreview.mockResolvedValue(preview({ approval: { required: true }, blockers: ['GATE_BLOCKED'] }));
    renderDialog('SWITCH');
    expect(await screen.findByRole('button', { name: '확인' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /승인 요청 보내기/ })).toBeNull();
  });
});

describe('ProdSwitchDialog — 단독 롤백 모드(직전 운영 버전)', () => {
  const soloPreview = (): ProdSwitchPreviewResponse => preview({ kind: 'ROLLBACK', approval: { required: true, soloRollbackAllowed: true } });

  it('"승인 예외" 배지와 긴급 복구 안내, 필수 체크가 있고 미체크로 확정하면 인라인 오류를 낸다', async () => {
    const user = userEvent.setup();
    mockProdPreview.mockResolvedValue(soloPreview());
    renderDialog('ROLLBACK');
    expect(await screen.findByRole('dialog', { name: '직전 버전으로 되돌리기' })).toBeInTheDocument();
    expect(screen.getByText('승인 예외')).toBeInTheDocument();
    expect(screen.getByText(/긴급 복구를 위해 승인 없이 바로 실행됩니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'v44로 즉시 되돌리기(승인 없이)' }));
    expect(mockProdRollback).not.toHaveBeenCalled();
    expect(await screen.findByText('승인 없이 바로 실행되는 것을 이해했는지 체크해 주세요.')).toBeInTheDocument();
  });

  it('체크 후 확정하면 기존 롤백 API를 즉시 호출한다', async () => {
    const user = userEvent.setup();
    const onSwitched = vi.fn();
    mockProdPreview.mockResolvedValue(soloPreview());
    mockProdRollback.mockResolvedValue({ prod: { versionNo: 44 } });
    renderDialog('ROLLBACK', { onSwitched });
    await user.click(await screen.findByRole('checkbox', { name: '승인 없이 바로 실행됨을 이해했습니다' }));
    await user.click(screen.getByRole('button', { name: 'v44로 즉시 되돌리기(승인 없이)' }));
    await waitFor(() => expect(mockProdRollback).toHaveBeenCalledTimes(1));
    expect(mockCreateRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
  });

  it('"대신 승인 요청 보내기"를 누르면 요청 모드로 전환된다(즉시 되돌리지 않는다)', async () => {
    const user = userEvent.setup();
    mockProdPreview.mockResolvedValue(soloPreview());
    mockCreateRequest.mockResolvedValue({ id: 'req-2' });
    renderDialog('ROLLBACK');
    await user.click(await screen.findByRole('button', { name: '대신 승인 요청 보내기' }));
    expect(screen.getByRole('dialog', { name: '되돌리기 승인 요청' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'v44 되돌리기 승인 요청 보내기' }));
    await waitFor(() => expect(mockCreateRequest).toHaveBeenCalledWith('bot-1', expect.objectContaining({ action: 'PROD_ROLLBACK', targetVersionId: 'ver-44' })));
    expect(mockProdRollback).not.toHaveBeenCalled();
  });
});

describe('ProdSwitchDialog — 정책이 방금 켜진 경우(409 ENV_APPROVAL_REQUIRED)', () => {
  it('안내 후 미리보기를 다시 조회해 요청 모드로 바뀌고, 사유는 유지되며 자동 요청은 하지 않는다', async () => {
    const user = userEvent.setup();
    mockProdPreview.mockResolvedValueOnce(preview()).mockResolvedValue(preview({ approval: { required: true } }));
    mockProdSwitch.mockRejectedValue(new ApiError(409, 'x', 'ENV_APPROVAL_REQUIRED' as never, [{ field: 'reason', message: 'APPROVAL_REQUIRED' }]));
    renderDialog('SWITCH');
    await user.type(await screen.findByLabelText('사유(선택)'), '급한 수정');
    await user.click(screen.getByRole('button', { name: 'v44로 운영 전환' }));
    expect(await screen.findByText(/방금 이 챗봇에 운영 전환 2인 승인이 켜졌습니다\. 이제 승인 요청으로 진행해야 합니다/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'v44 승인 요청 보내기' })).toBeInTheDocument();
    expect(screen.getByLabelText('사유(선택)')).toHaveValue('급한 수정');
    expect(mockPreviewCalls()).toBe(2);
    expect(mockCreateRequest).not.toHaveBeenCalled();
  });
});

function mockPreviewCalls(): number {
  return mockProdPreview.mock.calls.length;
}

describe('ProdSwitchDialog — 정책 꺼짐(approval 키 없음)은 기존과 같다', () => {
  it('제목·확정 버튼·안내가 기존 그대로다', async () => {
    mockProdPreview.mockResolvedValue(preview());
    renderDialog('SWITCH');
    expect(await screen.findByRole('button', { name: 'v44로 운영 전환' })).toBeInTheDocument();
    expect(screen.queryByText(/승인/)).toBeNull();
  });
});
