import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { DeploySchedulePreviewResponse, DeployScheduleMeta } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';

expect.extend(toHaveNoViolations);

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockPreview = vi.fn();
const mockCreate = vi.fn();
const mockResume = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    preview: (...args: unknown[]) => mockPreview(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    resume: (...args: unknown[]) => mockResume(...args),
    // ReadinessWarningList가 useDeployScheduleTimezone()을 통해 간접 호출한다(§8.7과 별개 공백 —
    // 기존 ScheduleDeployDialog.spec.tsx는 readinessWarnings를 채우지 않아 이 경로를 타지 않았다).
    meta: (...args: unknown[]) => mockMeta(...args),
  },
}));

function baseMeta(): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
  };
}

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
      diffSummary: { rows: [{ category: 'INTENT', added: 1, changed: 0, removed: 0 }], totalChanged: 1, identical: false },
      blockers: [],
      requiresAcknowledgeActive: true,
    },
    readinessWarnings: [{ code: 'NO_RECENT_TEST_RUN' }],
    ...overrides,
  });
}

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2027-01-15T00:00:00+09:00'));
  mockPreview.mockReset();
  mockCreate.mockReset();
  mockResume.mockReset();
  mockMeta.mockReset();
  mockMeta.mockResolvedValue(baseMeta());
  mockUseAuth.mockReturnValue({ can: () => true });
  resetDeployScheduleMetaCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 디바운스(400ms) 이후 preview 응답까지 기다린다(`ScheduleDeployDialog.spec.tsx`와 동일한 헬퍼). */
async function waitForPreview(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  await waitFor(() => expect(mockPreview).toHaveBeenCalled());
}

/**
 * `ScheduleDeployDialog` axe 접근성 스캔(NFR-DA4) — `자동시험_전략.md` §8.7 항목 1에서 "디바운스
 * 가짜 타이머 + preview 비동기 응답이 겹쳐 axe()가 안정적으로 최종 렌더를 캡처하기 까다롭다"고 남긴
 * 공백을 메운다. 해법: 가짜 타이머로 디바운스를 강제 진행해 preview 응답까지 기다린 뒤(`waitForPreview`),
 * axe 호출 직전에 `vi.useRealTimers()`로 전환해 axe 내부의 비동기 처리가 가짜 시계에 걸리지 않게 한다.
 *
 * `apps/web/src/components/Modal.tsx`는 병행 작업 중인 다른 에이전트가 수정 중이다 — 이 스펙은 Modal의
 * 특정 aria 속성 유무를 직접 단언하지 않고(`aria-describedby` 등이 추가되면 이 스펙과 무관하게 결과가
 * 바뀔 수 있음), axe 스캔 결과(구조적 위반 0건)만 확인한다.
 */
describe('ScheduleDeployDialog — axe 접근성 스캔(NFR-DA4)', () => {
  it('S1 액션 선택 단계(사전 채움 없음) — RESTORE_VERSION 카드가 aria-disabled인 상태에도 접근성 위반이 없다', async () => {
    const { container } = render(
      <ScheduleDeployDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} timezone="Asia/Seoul" chatbotStatus="DRAFT" />,
    );
    await screen.findByRole('radiogroup');
    expect(mockPreview).not.toHaveBeenCalled();

    vi.useRealTimers();
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('RESTORE_VERSION 사전 채움 — 준비도 경고·변경요약·ACTIVE 확인체크박스가 모두 렌더된 화면에 접근성 위반이 없다', async () => {
    mockPreview.mockResolvedValue(restorePreview());
    const { container } = render(
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
    await screen.findByText('대상: v30');

    vi.useRealTimers();
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('SET_WEB_CHANNEL(방향 미고정) — 방향 선택 라디오 그룹이 렌더된 화면에 접근성 위반이 없다', async () => {
    mockPreview.mockResolvedValue(basePreview({ setWebChannel: { currentEnabled: false } }));
    const { container } = render(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SET_WEB_CHANNEL"
      />,
    );
    await screen.findByRole('group', { name: '방향' });
    await waitForPreview();

    vi.useRealTimers();
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('한도 초과 오류 배너(role="alert")가 함께 렌더된 화면에도 접근성 위반이 없다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockPreview.mockResolvedValue(restorePreview({ restore: { ...restorePreview().restore!, requiresAcknowledgeActive: false } }));
    mockCreate.mockRejectedValue(new ApiError(409, '한도 초과', 'DEPLOY_SCHEDULE_LIMIT_EXCEEDED'));
    const { container } = render(
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
    const confirmButton = await screen.findByRole('button', { name: /에 v30으로 복원 예약$/ });
    await user.click(confirmButton);
    await screen.findByText('이 챗봇에 이미 활성 예약이 5건 있습니다. 기존 예약을 취소하거나 완료된 뒤 다시 시도해 주세요.');

    vi.useRealTimers();
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
