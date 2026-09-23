import { StrictMode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RestorePreviewResponse, RestoreResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../../components/Toast';
import { ApiError } from '../../../../api/client';
import { RestoreDialog } from './RestoreDialog';

const mockRestorePreview = vi.fn();
const mockRestore = vi.fn();

vi.mock('../../../../api/versions', () => ({
  versionsApi: {
    restorePreview: (...args: unknown[]) => mockRestorePreview(...args),
    restore: (...args: unknown[]) => mockRestore(...args),
  },
}));

function basePreview(overrides: Partial<RestorePreviewResponse> = {}): RestorePreviewResponse {
  return {
    targetVersion: { id: 'ver-27', versionNo: 27, trigger: 'MANUAL', createdAt: new Date('2026-09-01T00:00:00.000Z'), schemaVersion: 1 },
    currentContentHash: 'a'.repeat(64),
    targetContentHash: 'b'.repeat(64),
    diffSummary: { rows: [], totalChanged: 0, identical: false },
    changesUndone: 3,
    laterVersionCount: 1,
    blockers: [],
    warnings: [],
    restorable: true,
    ...overrides,
  };
}

function baseRestoreResponse(overrides: Partial<RestoreResponse> = {}): RestoreResponse {
  return {
    restoredFromVersionNo: 27,
    backupVersionNo: 28,
    backupVersionId: 'ver-28',
    contentHash: 'c'.repeat(64),
    summary: {},
    reindexScheduled: true,
    reindexWasRunning: false,
    classifierDeleted: false,
    ...overrides,
  };
}

function renderDialog(
  onRestored = vi.fn(),
  onClose = vi.fn(),
  onRestoreInProgressElsewhere?: () => void,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RestoreDialog
          chatbotId="bot-1"
          targetVersionId="ver-27"
          targetVersionNo={27}
          isOpen
          onClose={onClose}
          onRestored={onRestored}
          onRestoreInProgressElsewhere={onRestoreInProgressElsewhere}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * L4 복원 대화상자(`version-history-ui-spec.md` §4.4). 오픈 즉시 미리보기 자동 호출,
 * 기본 포커스=취소(NFR-HA2), `ACTIVE_CHATBOT` 체크박스 게이팅, 409 재확인 흐름을 검증한다.
 */
describe('RestoreDialog', () => {
  beforeEach(() => {
    mockRestorePreview.mockReset();
    mockRestore.mockReset();
  });

  it('오픈 즉시 restorePreview를 자동 호출하고, 기본 포커스는 취소 버튼에 있다(NFR-HA2)', async () => {
    mockRestorePreview.mockResolvedValue(basePreview());
    renderDialog();

    await waitFor(() => expect(mockRestorePreview).toHaveBeenCalledWith('bot-1', 'ver-27'));
    await screen.findByRole('button', { name: 'v27로 복원' });

    expect(document.activeElement).toHaveAttribute('data-autofocus', 'cancel');
  });

  it('ACTIVE_CHATBOT 경고가 있으면 체크 전에는 확정 버튼이 비활성이고, 체크 후 확정 시 acknowledgeActive:true가 전달된다', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(basePreview({ warnings: [{ code: 'ACTIVE_CHATBOT' }] }));
    mockRestore.mockResolvedValue(baseRestoreResponse());
    const onRestored = vi.fn();
    renderDialog(onRestored);

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    expect(confirmButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', { name: /현재 운영 중입니다/ });
    await user.click(checkbox);
    expect(confirmButton).not.toBeDisabled();

    await user.click(confirmButton);

    await waitFor(() =>
      expect(mockRestore).toHaveBeenCalledWith('bot-1', 'ver-27', {
        expectedCurrentHash: 'a'.repeat(64),
        acknowledgeActive: true,
      }),
    );
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(baseRestoreResponse()));
  });

  it('ACTIVE 경고가 없으면 체크박스 없이 확정 버튼이 곧바로 활성 상태다', async () => {
    mockRestorePreview.mockResolvedValue(basePreview());
    renderDialog();

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    expect(confirmButton).not.toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('blockers가 있으면 확정 버튼이 렌더되지 않고 "확인" 버튼만 남는다', async () => {
    mockRestorePreview.mockResolvedValue(basePreview({ restorable: false, blockers: [{ code: 'RESTORE_IN_PROGRESS' }] }));
    renderDialog();

    await screen.findByText('다른 관리자가 이미 이 챗봇을 복원하고 있습니다. 완료 후 다시 시도해 주세요.');
    expect(screen.queryByRole('button', { name: 'v27로 복원' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument();
  });

  it('409 RESTORE_PREVIEW_STALE이면 다이얼로그를 닫지 않고 배너를 띄운 뒤 미리보기를 자동 재호출한다', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(basePreview());
    mockRestore.mockRejectedValue(new ApiError(409, '동시에 변경이 있었습니다.', 'RESTORE_PREVIEW_STALE'));
    const onClose = vi.fn();
    renderDialog(vi.fn(), onClose);

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    await user.click(confirmButton);

    await screen.findByText('미리보기 이후 자산이 변경되었습니다. 최신 내용으로 다시 확인합니다.');
    expect(mockRestorePreview).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    // 재확인 후에도 여전히 같은 다이얼로그(확정 버튼)가 남아 있다 — 자동 재시도는 하지 않는다(S-5).
    expect(screen.getByRole('button', { name: 'v27로 복원' })).toBeInTheDocument();
  });

  it('409 RESTORE_IN_PROGRESS면 다이얼로그를 닫고 안내 토스트를 띄운다', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(basePreview());
    mockRestore.mockRejectedValue(new ApiError(409, '이미 복원 중입니다.', 'RESTORE_IN_PROGRESS'));
    const onClose = vi.fn();
    renderDialog(vi.fn(), onClose);

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    await user.click(confirmButton);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('다른 관리자가 이미 이 챗봇을 복원하고 있습니다. 완료 후 다시 시도해 주세요.')).toBeInTheDocument();
  });

  it('409 RESTORE_IN_PROGRESS면 onRestoreInProgressElsewhere가 지정된 경우 onClose 대신 그것이 호출된다(L-3)', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(basePreview());
    mockRestore.mockRejectedValue(new ApiError(409, '이미 복원 중입니다.', 'RESTORE_IN_PROGRESS'));
    const onClose = vi.fn();
    const onRestoreInProgressElsewhere = vi.fn();
    renderDialog(vi.fn(), onClose, onRestoreInProgressElsewhere);

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    await user.click(confirmButton);

    await waitFor(() => expect(onRestoreInProgressElsewhere).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('M-1: 미리보기 응답 대기 중 언마운트되면 이후 응답이 와도 상태 갱신을 시도하지 않는다', async () => {
    let resolvePreview: (v: RestorePreviewResponse) => void = () => {};
    mockRestorePreview.mockReturnValue(
      new Promise<RestorePreviewResponse>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderDialog();

    await waitFor(() => expect(mockRestorePreview).toHaveBeenCalled());
    unmount();
    resolvePreview(basePreview());
    await new Promise((r) => setTimeout(r, 0));

    const unmountedWarning = consoleError.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('unmounted')),
    );
    expect(unmountedWarning).toBe(false);
    consoleError.mockRestore();
  });

  it('M-1: 확정(restore) 요청 진행 중 언마운트되면 응답이 와도 onRestored를 호출하지 않고 경고도 없다', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(basePreview());
    let resolveRestore: (v: RestoreResponse) => void = () => {};
    mockRestore.mockReturnValue(
      new Promise<RestoreResponse>((resolve) => {
        resolveRestore = resolve;
      }),
    );
    const onRestored = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderDialog(onRestored);

    const confirmButton = await screen.findByRole('button', { name: 'v27로 복원' });
    await user.click(confirmButton);
    await waitFor(() => expect(mockRestore).toHaveBeenCalled());

    unmount();
    resolveRestore(baseRestoreResponse());
    await new Promise((r) => setTimeout(r, 0));

    expect(onRestored).not.toHaveBeenCalled();
    const unmountedWarning = consoleError.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('unmounted')),
    );
    expect(unmountedWarning).toBe(false);
    consoleError.mockRestore();
  });

  it('M-1: StrictMode(개발 모드의 mount→unmount→remount)에서도 미리보기 응답이 반영된다', async () => {
    mockRestorePreview.mockResolvedValue(basePreview());
    render(
      <StrictMode>
        <MemoryRouter>
          <ToastProvider>
            <RestoreDialog chatbotId="bot-1" targetVersionId="ver-27" targetVersionNo={27} isOpen onClose={vi.fn()} onRestored={vi.fn()} />
          </ToastProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole('button', { name: 'v27로 복원' })).toBeInTheDocument();
  });
});
