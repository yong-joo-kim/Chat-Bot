import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { GateEvaluation, ProdSwitchPreviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { ProdSwitchDialog } from './ProdSwitchDialog';

expect.extend(toHaveNoViolations);

const mockProdPreview = vi.fn();
const mockProdSwitch = vi.fn();
const mockProdRollback = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    prodPreview: (...args: unknown[]) => mockProdPreview(...args),
    prodSwitch: (...args: unknown[]) => mockProdSwitch(...args),
    prodRollback: (...args: unknown[]) => mockProdRollback(...args),
  },
}));

const PASS_GATE: GateEvaluation = { verdict: 'PASS', reason: 'PASSED', run: { runId: 'run-1', setId: 'set-1', setName: '정기 회귀', passRate: 0.983, finishedAt: new Date('2026-09-25T04:50:00.000Z') } };

function basePreview(overrides: Partial<ProdSwitchPreviewResponse> = {}): ProdSwitchPreviewResponse {
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

// R1 M-1 — `ProdSwitchDialog`의 GATE_CONFIG_ERROR 링크가 `Link`(react-router)로 바뀌어
// Router 컨텍스트가 필요하다. 모든 렌더를 `MemoryRouter`로 감싼다.
function renderDialog(kind: 'SWITCH' | 'ROLLBACK' = 'SWITCH', onSwitched = vi.fn(), onClose = vi.fn()): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProdSwitchDialog chatbotId="bot-1" kind={kind} targetVersionId="ver-44" isOpen onClose={onClose} onSwitched={onSwitched} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** EN1-d 운영 전환·롤백 공용(`environment-separation-ui-spec.md` §4.6). */
describe('ProdSwitchDialog', () => {
  beforeEach(() => {
    mockProdPreview.mockReset();
    mockProdSwitch.mockReset();
    mockProdRollback.mockReset();
  });

  it('오픈 즉시 prodPreview를 호출하고, 기본 포커스는 취소 버튼에 있다(NFR-ENA2)', async () => {
    mockProdPreview.mockResolvedValue(basePreview());
    renderDialog();

    await waitFor(() => expect(mockProdPreview).toHaveBeenCalledWith('bot-1', { kind: 'SWITCH', targetVersionId: 'ver-44' }));
    await screen.findByRole('button', { name: 'v44로 운영 전환' });
    expect(document.activeElement).toHaveAttribute('data-autofocus', 'cancel');
  });

  it('확정 버튼은 항상 대상 버전 번호를 명시한다(NFR-ENA2)', async () => {
    mockProdPreview.mockResolvedValue(basePreview());
    renderDialog();
    await screen.findByRole('button', { name: 'v44로 운영 전환' });
  });

  it('outcome=NOOP이면 확인 버튼만 있고 확정 버튼은 없다(EX-EN-16)', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ outcome: 'NOOP' }));
    renderDialog();

    await screen.findByText('이미 이 버전이 운영입니다.');
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /v44로 운영 전환/ })).not.toBeInTheDocument();
  });

  it('게이트 BLOCK(전환)이면 확정 버튼이 렌더되지 않고 blocker 문구만 보인다', async () => {
    mockProdPreview.mockResolvedValue(
      basePreview({ gate: { verdict: 'BLOCK', reason: 'BELOW_THRESHOLD', run: { ...PASS_GATE.run!, passRate: 0.91 } }, blockers: ['GATE_BLOCKED'] }),
    );
    renderDialog();

    await screen.findByText(/필수 시험 기준을 충족하지 못해 전환할 수 없습니다/);
    expect(screen.queryByRole('button', { name: /v44로 운영 전환/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument();
  });

  it('GATE_CONFIG_ERROR면 게이트 설정 섹션을 펼친 채로 여는 링크(?openGate=1)가 함께 보인다(§4.6(c))', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ blockers: ['GATE_CONFIG_ERROR'] }));
    renderDialog();

    await screen.findByText('게이트에 지정된 TC 세트를 찾을 수 없습니다.');
    expect(screen.getByRole('link', { name: '게이트 설정 다시 보기' })).toHaveAttribute('href', '/chatbots/bot-1/environment?openGate=1');
  });

  it('롤백에서는 게이트 BLOCK도 경고로만 표시되고 확정 버튼이 활성화된다(FR-EN4-4)', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ kind: 'ROLLBACK', blockers: ['GATE_BLOCKED'], gate: { verdict: 'BLOCK', reason: 'BELOW_THRESHOLD', run: null } }));
    renderDialog('ROLLBACK');

    await screen.findByText('경고');
    expect(screen.getByRole('button', { name: 'v44으로 되돌리기' })).toBeInTheDocument();
  });

  it('경고가 있으면 확인 체크박스를 선택해야 확정 버튼이 활성화된다', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ warnings: [{ code: 'LEGACY_TIEBREAK' }] }));
    renderDialog();

    const confirmBtn = await screen.findByRole('button', { name: 'v44로 운영 전환' });
    expect(confirmBtn).toHaveAttribute('aria-disabled', 'false');

    const user = userEvent.setup();
    await user.click(confirmBtn);
    await screen.findByText('경고 내용을 확인해야 진행할 수 있습니다.');
    expect(mockProdSwitch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    await user.click(confirmBtn);
    await waitFor(() => expect(mockProdSwitch).toHaveBeenCalled());
  });

  it('ENV_SWITCH_BUSY 409면 배너를 띄우고 자동 재확인한다(재시도 가능)', async () => {
    mockProdPreview.mockResolvedValue(basePreview());
    mockProdSwitch.mockRejectedValue(new ApiError(409, '지연', 'ENV_SWITCH_BUSY'));
    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'v44로 운영 전환' }));

    await screen.findByText('잠시 후 다시 시도해 주세요.');
    expect(mockProdPreview).toHaveBeenCalledTimes(2);
  });

  it('성공하면 kind=SWITCH일 때 prodSwitch를, kind=ROLLBACK일 때 prodRollback을 호출한다', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ kind: 'ROLLBACK' }));
    mockProdRollback.mockResolvedValue({ outcome: 'APPLIED', prod: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null }, fromVersionNo: 43, semanticPending: 0 });
    const onSwitched = vi.fn();
    renderDialog('ROLLBACK', onSwitched);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'v44으로 되돌리기' }));

    await waitFor(() => expect(mockProdRollback).toHaveBeenCalled());
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
  });

  it('axe 스캔 위반 0건(경고 있는 상태)', async () => {
    mockProdPreview.mockResolvedValue(basePreview({ warnings: [{ code: 'SEMANTIC_INDEX_PENDING', count: 2 }] }));
    const { container } = renderDialog();
    await screen.findByRole('button', { name: 'v44로 운영 전환' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
