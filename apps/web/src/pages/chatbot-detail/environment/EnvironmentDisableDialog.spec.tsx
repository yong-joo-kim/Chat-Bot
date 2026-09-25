import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { DisableEnvironmentPreviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { EnvironmentDisableDialog } from './EnvironmentDisableDialog';

expect.extend(toHaveNoViolations);

const mockDisablePreview = vi.fn();
const mockDisable = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    disablePreview: (...args: unknown[]) => mockDisablePreview(...args),
    disable: (...args: unknown[]) => mockDisable(...args),
  },
}));

const mockRestorePreview = vi.fn();
const mockRestore = vi.fn();
vi.mock('../../../api/versions', () => ({
  versionsApi: {
    restorePreview: (...args: unknown[]) => mockRestorePreview(...args),
    restore: (...args: unknown[]) => mockRestore(...args),
  },
}));

function basePreview(overrides: Partial<DisableEnvironmentPreviewResponse> = {}): DisableEnvironmentPreviewResponse {
  return {
    prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date('2026-09-20T00:00:00.000Z'), label: null },
    draftContentHash: 'a'.repeat(64),
    prodContentHash: 'b'.repeat(64),
    draftDiffersFromProd: false,
    diffSummary: { rows: [], totalChanged: 0, identical: true },
    cancelledSwitchSchedules: 0,
    potentialTieShift: false,
    ...overrides,
  };
}

function renderDialog(onDisabled = vi.fn(), onClose = vi.fn()): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <EnvironmentDisableDialog chatbotId="bot-1" isOpen onClose={onClose} onDisabled={onDisabled} />
    </ToastProvider>,
  );
}

/** EN1-b 끄기 확인 대화상자(`environment-separation-ui-spec.md` §4.4). */
describe('EnvironmentDisableDialog', () => {
  beforeEach(() => {
    mockDisablePreview.mockReset();
    mockDisable.mockReset();
    mockRestorePreview.mockReset();
    mockRestore.mockReset();
  });

  it('초안=운영이면 선택지 없이 확인 문구만 보여준다', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: false }));
    renderDialog();

    await screen.findByText('초안과 운영이 같은 상태입니다. 끄면 앞으로 편집이 즉시 운영에 반영됩니다.');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('초안≠운영이면 2択 라디오가 뜨고 기본 선택은 "운영 유지"다(P-6)', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true }));
    renderDialog();

    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[0]).toHaveAccessibleName(/운영\(v43\) 상태 유지/);
  });

  it('"운영 유지" 확정 시 restorePreview→restore→disable 순서로 호출하고 사용자에게는 단일 로딩으로 보인다', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true }));
    mockRestorePreview.mockResolvedValue({ currentContentHash: 'x'.repeat(64) });
    mockRestore.mockResolvedValue({ contentHash: 'y'.repeat(64) });
    mockDisable.mockResolvedValue({ enabled: false, gate: null, cancelledSwitchSchedules: 0 });
    const onDisabled = vi.fn();
    renderDialog(onDisabled);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '환경 분리 끄기' }));

    await waitFor(() => expect(mockRestorePreview).toHaveBeenCalledWith('bot-1', 'ver-43'));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('bot-1', 'ver-43', expect.objectContaining({ expectedCurrentHash: 'x'.repeat(64) })));
    await waitFor(() =>
      expect(mockDisable).toHaveBeenCalledWith('bot-1', { mode: 'KEEP_PROD', expectedProdVersionId: 'ver-43', expectedDraftHash: 'y'.repeat(64) }),
    );
    await waitFor(() => expect(onDisabled).toHaveBeenCalled());
  });

  it('"초안을 운영으로" 선택 시 복원 단계 없이 바로 disable을 호출한다', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true }));
    mockDisable.mockResolvedValue({ enabled: false, gate: null, cancelledSwitchSchedules: 0 });
    renderDialog();

    const user = userEvent.setup();
    const radios = await screen.findAllByRole('radio');
    await user.click(radios[1]);
    await user.click(screen.getByRole('button', { name: '환경 분리 끄기' }));

    await waitFor(() =>
      expect(mockDisable).toHaveBeenCalledWith('bot-1', { mode: 'PROMOTE_DRAFT', expectedProdVersionId: 'ver-43', expectedDraftHash: 'a'.repeat(64) }),
    );
    expect(mockRestorePreview).not.toHaveBeenCalled();
  });

  it('ENV_DRAFT_NOT_RESTORED 409면 1단계부터 재시도하라는 오류를 보여준다', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true }));
    mockRestorePreview.mockResolvedValue({ currentContentHash: 'x'.repeat(64) });
    mockRestore.mockResolvedValue({ contentHash: 'y'.repeat(64) });
    mockDisable.mockRejectedValue(new ApiError(409, '실패', 'ENV_DRAFT_NOT_RESTORED'));
    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '환경 분리 끄기' }));

    await screen.findByText('초안 복원이 완료되지 않았습니다. 다시 시도해 주세요.');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('동점 경고(potentialTieShift)는 "운영 유지" 선택 시에만 보인다', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true, potentialTieShift: true }));
    renderDialog();

    await screen.findByText('동점 규칙이 복원 시점 기준으로 바뀔 수 있습니다.');
  });

  it('axe 스캔 위반 0건', async () => {
    mockDisablePreview.mockResolvedValue(basePreview({ draftDiffersFromProd: true, potentialTieShift: true }));
    const { container } = renderDialog();
    await screen.findAllByRole('radio');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
