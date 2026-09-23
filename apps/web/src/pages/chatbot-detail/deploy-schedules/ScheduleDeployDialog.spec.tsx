import { StrictMode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeploySchedulePreviewResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockPreview = vi.fn();
const mockCreate = vi.fn();
const mockResume = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    preview: (...args: unknown[]) => mockPreview(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    resume: (...args: unknown[]) => mockResume(...args),
  },
}));

vi.mock('../../../api/validation', () => ({
  testSetsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) },
}));

function basePreview(overrides: Partial<DeploySchedulePreviewResponse> = {}): DeploySchedulePreviewResponse {
  return {
    creatable: true,
    preconditionFailures: [],
    timeViolations: [],
    readinessWarnings: [],
    ...overrides,
  };
}

function restorePreview(overrides: Partial<DeploySchedulePreviewResponse> = {}): DeploySchedulePreviewResponse {
  return basePreview({
    restore: {
      base: { kind: 'CURRENT', contentHash: 'a'.repeat(64) },
      targetVersion: { id: 'ver-30', versionNo: 30 },
      targetContentHash: 'b'.repeat(64),
      diffSummary: { rows: [], totalChanged: 0, identical: false },
      blockers: [],
      requiresAcknowledgeActive: false,
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2027-01-15T00:00:00+09:00'));
  mockPreview.mockReset();
  mockCreate.mockReset();
  mockResume.mockReset();
  mockUseAuth.mockReturnValue({ can: () => false });
});

afterEach(() => {
  vi.useRealTimers();
});

/** 디바운스(400ms) 이후 preview 응답까지 기다린다(가짜 타이머 + RTL이 함께 진행되도록 act로 감싼다). */
async function waitForPreview(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  await waitFor(() => expect(mockPreview).toHaveBeenCalled());
}

/**
 * S3 `ScheduleDeployDialog`(`scheduled-deploy-ui-spec.md` §4.3). 진입 경로별 사전 채움,
 * 미리보기→생성 흐름, 시간대 변환·시각/한도 오류를 검증한다.
 */
describe('ScheduleDeployDialog', () => {
  it('E1(버전 이력 "예약 복원") 진입 — action/버전이 고정된 채 열리고, 시각대 라벨(KST, UTC+9)이 항상 병기된다', async () => {
    mockPreview.mockResolvedValue(restorePreview());
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );

    expect(screen.getByText('대상: v30')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '실행 시각(KST, UTC+9 기준)' })).toBeInTheDocument();
    await waitForPreview();
    expect(mockPreview).toHaveBeenCalledWith('bot-1', expect.objectContaining({ action: 'RESTORE_VERSION', versionId: 'ver-30' }));
  });

  it('E3(채널 카드 "닫기 예약") 진입 — enabled가 고정되면 방향 선택 라디오가 렌더되지 않고 확정 라벨이 "닫기"로 표시된다', async () => {
    mockPreview.mockResolvedValue(basePreview({ setWebChannel: { currentEnabled: true } }));
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SET_WEB_CHANNEL"
        enabled={false}
      />,
    );

    expect(screen.queryByRole('group', { name: '방향' })).not.toBeInTheDocument();
    await waitForPreview();
    await screen.findByRole('button', { name: /웹 채널 닫기 예약$/ });
  });

  it('S1 "+ 예약 만들기"(진입 문맥 없음) — ActionPickerStep이 먼저 렌더되고, versionId가 없으면 "버전 복원" 카드가 aria-disabled다', async () => {
    render(
      <ScheduleDeployDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} timezone="Asia/Seoul" chatbotStatus="DRAFT" />,
    );

    const restoreCard = screen.getByRole('radio', { name: /버전 복원/ });
    expect(restoreCard).toHaveAttribute('aria-disabled', 'true');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('미리보기→생성: 확정 버튼 클릭 시 previewedContentHash(=base.contentHash)를 포함해 create가 호출되고 onCreated(라벨)가 호출된다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockPreview.mockResolvedValue(restorePreview());
    mockCreate.mockResolvedValue({ schedule: {}, readinessWarnings: [] });
    const onCreated = vi.fn();
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={onCreated}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );
    await waitForPreview();

    const confirmButton = await screen.findByRole('button', { name: /에 v30으로 복원 예약$/ });
    expect(confirmButton).not.toBeDisabled();
    await user.click(confirmButton);

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ action: 'RESTORE_VERSION', versionId: 'ver-30', previewedContentHash: 'a'.repeat(64) }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/에 v30으로 복원 예약$/));
  });

  it('시각 오류(LEAD) — 서버 timeViolations에 LEAD가 있으면 ScheduledAtField에 인라인 오류가 뜨고 확정 버튼이 비활성화된다', async () => {
    mockPreview.mockResolvedValue(restorePreview({ creatable: false, timeViolations: [{ rule: 'LEAD' }] }));
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );
    await waitForPreview();

    expect(await screen.findByText(/예약 시각은 지금부터 5분 이후여야 합니다/)).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: /에 v30으로 복원 예약$/ });
    expect(confirmButton).toBeDisabled();
  });

  it('한도 초과(409 DEPLOY_SCHEDULE_LIMIT_EXCEEDED) — 생성 실패 시 오류 배너가 뜨고 다이얼로그는 닫히지 않는다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockPreview.mockResolvedValue(restorePreview());
    mockCreate.mockRejectedValue(new ApiError(409, '한도 초과', 'DEPLOY_SCHEDULE_LIMIT_EXCEEDED'));
    const onClose = vi.fn();
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={onClose}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );
    await waitForPreview();

    const confirmButton = await screen.findByRole('button', { name: /에 v30으로 복원 예약$/ });
    await user.click(confirmButton);

    expect(await screen.findByText('이 챗봇에 이미 활성 예약이 5건 있습니다. 기존 예약을 취소하거나 완료된 뒤 다시 시도해 주세요.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('H-1: RESUME 모드에서는 preview 호출에 excludeScheduleId(=resumeScheduleId)가 포함된다(자기 자신을 선행 예약으로 오인하지 않도록)', async () => {
    mockPreview.mockResolvedValue(restorePreview());
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        mode="RESUME"
        resumeScheduleId="sched-held-1"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );
    await waitForPreview();

    expect(mockPreview).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({ action: 'RESTORE_VERSION', versionId: 'ver-30', excludeScheduleId: 'sched-held-1' }),
    );
  });

  it('H-1: 신규 생성(CREATE) 모드의 preview 호출에는 excludeScheduleId가 없다', async () => {
    mockPreview.mockResolvedValue(restorePreview());
    render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="RESTORE_VERSION"
        versionId="ver-30"
        versionNo={30}
      />,
    );
    await waitForPreview();

    const [, dto] = mockPreview.mock.calls[0] as [string, Record<string, unknown>];
    expect(dto).not.toHaveProperty('excludeScheduleId');
  });

  it('StrictMode에서도 이중 마운트 안전하게 미리보기가 정확히 반영된다', async () => {
    mockPreview.mockResolvedValue(restorePreview());
    render(
      <StrictMode>
        <ScheduleDeployDialog
          chatbotId="bot-1"
          isOpen
          onClose={vi.fn()}
          onCreated={vi.fn()}
          timezone="Asia/Seoul"
          chatbotStatus="ACTIVE"
          initialAction="RESTORE_VERSION"
          versionId="ver-30"
          versionNo={30}
        />
      </StrictMode>,
    );
    await waitForPreview();

    expect(await screen.findByRole('button', { name: /에 v30으로 복원 예약$/ })).toBeInTheDocument();
  });
});
