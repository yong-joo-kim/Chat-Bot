import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DeploySchedulePreviewResponse, EnvironmentStatus } from '@chat-bot/shared-types';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';

// R1 M-1 — GATE_CONFIG_ERROR 시 렌더되는 게이트 설정 링크가 `Link`(react-router)로 바뀌어
// Router 컨텍스트가 필요하다. 이 스위트의 렌더를 모두 `MemoryRouter`로 감싼다.
function renderDialog(ui: JSX.Element): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockPreview = vi.fn();
const mockCreate = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    preview: (...args: unknown[]) => mockPreview(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    resume: vi.fn(),
  },
}));

vi.mock('../../../api/validation', () => ({
  testSetsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) },
}));

const mockHistory = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    history: (...args: unknown[]) => mockHistory(...args),
  },
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

function switchProdPreview(overrides: Partial<DeploySchedulePreviewResponse> = {}): DeploySchedulePreviewResponse {
  return basePreview({
    switchProd: {
      base: 'CURRENT',
      // [신규 No.40 — 2026-09-25 계약 보강] 체인이면 선행 예약의 대상, 아니면 지금의 실제 운영 버전 id.
      expectedProdVersionId: 'ver-43',
      targetVersion: { id: 'ver-44', versionNo: 44 },
      gate: { verdict: 'PASS', reason: 'PASSED', run: { runId: 'run-1', setId: 'set-1', setName: '정기 회귀', passRate: 0.98, finishedAt: new Date('2026-09-25T00:00:00.000Z') } },
      blockers: [],
      warnings: [],
    },
    ...overrides,
  });
}

const ENV_ENABLED: EnvironmentStatus = {
  enabled: true,
  enabledAt: new Date('2026-09-20T00:00:00.000Z'),
  prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
  staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
  draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
  gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
  activeSwitchSchedule: null,
} as EnvironmentStatus;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2027-01-15T00:00:00+09:00'));
  mockPreview.mockReset();
  mockCreate.mockReset();
  mockHistory.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mockUseAuth.mockReturnValue({ can: () => true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function waitForPreview(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  await waitFor(() => expect(mockPreview).toHaveBeenCalled());
}

/**
 * [신규 No.40] `ScheduleDeployDialog`의 `SWITCH_PROD_VERSION` 확장(`environment-separation-ui-spec.md` §4.9).
 */
describe('ScheduleDeployDialog — SWITCH_PROD_VERSION(No.40)', () => {
  it('환경 분리가 꺼져 있으면 "운영 버전 전환" 카드가 aria-disabled다', () => {
    renderDialog(
      <ScheduleDeployDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} timezone="Asia/Seoul" chatbotStatus="ACTIVE" environmentStatus={{ enabled: false, gate: null }} />,
    );
    const card = screen.getByRole('radio', { name: /운영 버전 전환/ });
    expect(card).toHaveAttribute('aria-disabled', 'true');
  });

  it('환경 분리가 켜져 있고 권한이 있으면 카드가 활성화되고, 선택하면 대상 선택(스테이징) 라디오가 뜬다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog(
      <ScheduleDeployDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} timezone="Asia/Seoul" chatbotStatus="ACTIVE" environmentStatus={ENV_ENABLED} />,
    );
    const card = screen.getByRole('radio', { name: /운영 버전 전환/ });
    expect(card).toHaveAttribute('aria-disabled', 'false');
    await user.click(card);

    expect(await screen.findByText('대상 버전 선택')).toBeInTheDocument();
    expect(screen.getByText('스테이징(v44)')).toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('대상이 이미 고정된 진입(EN1)이면 즉시 미리보기가 호출되고, 확정 버튼에 시각+버전이 명시된다', async () => {
    mockPreview.mockResolvedValue(switchProdPreview());
    renderDialog(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SWITCH_PROD_VERSION"
        versionId="ver-44"
        versionNo={44}
        environmentStatus={ENV_ENABLED}
      />,
    );
    await waitForPreview();
    expect(mockPreview).toHaveBeenCalledWith('bot-1', expect.objectContaining({ action: 'SWITCH_PROD_VERSION', targetVersionId: 'ver-44' }));

    await screen.findByRole('button', { name: /에 v44으로 운영 전환 예약$/ });
  });

  // [R1 — 백엔드 리뷰 L-1] 예약 전환은 생성 시점의 경고만 확인하고, 실행 시점에는 게이트 차단만
  // 재검사한다는 점을 안내하는 문구가 게이트/경고 근처에 보여야 한다.
  it('게이트·경고 근처에 "예약 전환은 생성 시점의 경고만 확인합니다" 안내 문구가 보인다', async () => {
    mockPreview.mockResolvedValue(switchProdPreview());
    renderDialog(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SWITCH_PROD_VERSION"
        versionId="ver-44"
        versionNo={44}
        environmentStatus={ENV_ENABLED}
      />,
    );
    await waitForPreview();

    await screen.findByText('예약 전환은 생성 시점의 경고만 확인합니다. 실행 시점에는 게이트 차단만 다시 검사합니다.');
  });

  it('경고가 있으면 확인 체크박스를 선택해야 제출할 수 있다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockPreview.mockResolvedValue(switchProdPreview({ switchProd: { ...switchProdPreview().switchProd!, warnings: [{ code: 'LEGACY_TIEBREAK' }] } }));
    mockCreate.mockResolvedValue({ schedule: {}, readinessWarnings: [] });
    renderDialog(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SWITCH_PROD_VERSION"
        versionId="ver-44"
        versionNo={44}
        environmentStatus={ENV_ENABLED}
      />,
    );
    await waitForPreview();

    const confirmButton = await screen.findByRole('button', { name: /에 v44으로 운영 전환 예약$/ });
    await user.click(confirmButton);
    await screen.findByText('경고 내용을 확인해야 진행할 수 있습니다.');
    expect(mockCreate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: '위 내용을 확인했습니다.' }));
    await user.click(confirmButton);
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ action: 'SWITCH_PROD_VERSION', targetVersionId: 'ver-44', acknowledgeWarnings: true, previewedProdVersionId: 'ver-43' }),
      ),
    );
  });

  it('체인 예약(선행 전환 예약 존재)이면 previewedProdVersionId로 지금의 실제 운영이 아니라 switchProd.expectedProdVersionId(체인 기준)를 보낸다', async () => {
    // base='SCHEDULE' — 선행 전환 예약의 대상(v44)이 기준. environmentStatus.prod.versionId(ver-43, 지금의
    // 실제 운영)를 그대로 보내면 서버 트랜잭션에서 기준이 달라 409 ENV_POINTER_STALE가 났던 문제(수정 전).
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockPreview.mockResolvedValue(
      switchProdPreview({ switchProd: { ...switchProdPreview().switchProd!, base: 'SCHEDULE', expectedProdVersionId: 'ver-44' } }),
    );
    mockCreate.mockResolvedValue({ schedule: {}, readinessWarnings: [] });
    renderDialog(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SWITCH_PROD_VERSION"
        versionId="ver-45"
        versionNo={45}
        environmentStatus={ENV_ENABLED}
      />,
    );
    await waitForPreview();

    const confirmButton = await screen.findByRole('button', { name: /에 v45으로 운영 전환 예약$/ });
    await user.click(confirmButton);

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'bot-1',
        expect.objectContaining({ action: 'SWITCH_PROD_VERSION', targetVersionId: 'ver-45', previewedProdVersionId: 'ver-44' }),
      ),
    );
  });

  it('블록(blockers)이 있으면 확정 버튼이 없고 차단 문구가 보인다', async () => {
    mockPreview.mockResolvedValue(switchProdPreview({ creatable: false, switchProd: { ...switchProdPreview().switchProd!, blockers: ['GATE_CONFIG_ERROR'] } }));
    renderDialog(
      <ScheduleDeployDialog
        chatbotId="bot-1"
        isOpen
        onClose={vi.fn()}
        onCreated={vi.fn()}
        timezone="Asia/Seoul"
        chatbotStatus="ACTIVE"
        initialAction="SWITCH_PROD_VERSION"
        versionId="ver-44"
        versionNo={44}
        environmentStatus={ENV_ENABLED}
      />,
    );
    await waitForPreview();
    await screen.findByText('게이트에 지정된 TC 세트를 찾을 수 없습니다.');
    expect(screen.getByRole('button', { name: /에 v44으로 운영 전환 예약$/ })).toBeDisabled();
  });
});
