import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { EnableEnvironmentPreviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { EnvironmentEnableDialog } from './EnvironmentEnableDialog';

expect.extend(toHaveNoViolations);

const mockEnablePreview = vi.fn();
const mockEnable = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    enablePreview: (...args: unknown[]) => mockEnablePreview(...args),
    enable: (...args: unknown[]) => mockEnable(...args),
  },
}));

function basePreview(overrides: Partial<EnableEnvironmentPreviewResponse> = {}): EnableEnvironmentPreviewResponse {
  return {
    draftContentHash: 'a'.repeat(64),
    version: { action: 'CREATE' },
    heldRestoreSchedules: 0,
    blockers: [],
    ...overrides,
  };
}

function renderDialog(onEnabled = vi.fn(), onClose = vi.fn()): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <EnvironmentEnableDialog chatbotId="bot-1" isOpen onClose={onClose} onEnabled={onEnabled} />
    </ToastProvider>,
  );
}

/** EN1-a 켜기 확인 대화상자(`environment-separation-ui-spec.md` §4.3). */
describe('EnvironmentEnableDialog', () => {
  beforeEach(() => {
    mockEnablePreview.mockReset();
    mockEnable.mockReset();
  });

  it('오픈 즉시 enablePreview를 호출하고, 기본 포커스는 취소 버튼에 있다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview());
    renderDialog();

    await waitFor(() => expect(mockEnablePreview).toHaveBeenCalledWith('bot-1'));
    await screen.findByRole('button', { name: '환경 분리 사용' });
    expect(document.activeElement).toHaveAttribute('data-autofocus', 'cancel');
  });

  it('보류되는 예약이 0건이면 안내 줄이 뜨지 않는다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview({ heldRestoreSchedules: 0 }));
    renderDialog();

    await screen.findByRole('button', { name: '환경 분리 사용' });
    expect(screen.queryByText(/보류/)).not.toBeInTheDocument();
  });

  it('보류되는 예약이 1건 이상이면 안내 줄이 뜬다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview({ heldRestoreSchedules: 1 }));
    renderDialog();

    await screen.findByText(/예약된 버전 복원 1건이 보류/);
  });

  it('REUSE면 기존 버전 번호를 문구에 담는다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview({ version: { action: 'REUSE', versionId: 'ver-9', versionNo: 9 } }));
    renderDialog();

    await screen.findByText(/기존 버전\(v9\)으로 지정하고/);
  });

  it('blockers가 있으면 확정 버튼이 렌더되지 않는다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview({ blockers: ['CHATBOT_ARCHIVED'] }));
    renderDialog();

    await screen.findByText('보관된 챗봇은 환경 분리를 켤 수 없습니다.');
    expect(screen.queryByRole('button', { name: '환경 분리 사용' })).not.toBeInTheDocument();
  });

  it('확정하면 enable을 호출하고 onEnabled를 부른다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview());
    mockEnable.mockResolvedValue({ enabled: true, heldRestoreSchedules: 0 });
    const onEnabled = vi.fn();
    renderDialog(onEnabled);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '환경 분리 사용' }));

    await waitFor(() => expect(mockEnable).toHaveBeenCalledWith('bot-1', { expectedDraftHash: 'a'.repeat(64) }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalled());
  });

  it('ENV_POINTER_STALE 409면 배너를 띄우고 미리보기를 다시 불러온다(자동 재확인)', async () => {
    mockEnablePreview.mockResolvedValue(basePreview());
    mockEnable.mockRejectedValue(new ApiError(409, '충돌', 'ENV_POINTER_STALE'));
    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '환경 분리 사용' }));

    await screen.findByText('다른 관리자가 먼저 처리했습니다. 최신 상태로 다시 확인합니다.');
    expect(mockEnablePreview).toHaveBeenCalledTimes(2);
  });

  it('ENV_SWITCH_BUSY 409면 재시도 가능한 배너(잠시 후 다시 시도)를 띄운다', async () => {
    mockEnablePreview.mockResolvedValue(basePreview());
    mockEnable.mockRejectedValue(new ApiError(409, '지연', 'ENV_SWITCH_BUSY'));
    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '환경 분리 사용' }));

    await screen.findByText('잠시 후 다시 시도해 주세요.');
    expect(mockEnablePreview).toHaveBeenCalledTimes(2);
  });

  it('axe 스캔 위반 0건', async () => {
    mockEnablePreview.mockResolvedValue(basePreview({ heldRestoreSchedules: 2 }));
    const { container } = renderDialog();
    await screen.findByRole('button', { name: '환경 분리 사용' });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
