import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DeployScheduleListItem, DeploySchedulePreviewResponse, EnvironmentStatus } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { CHATBOT_ID, makeApproval, makePolicyStatus } from '../guardrails/testFixtures';
import { DeployScheduleRow } from './DeployScheduleRow';
import { ScheduleDeployDialog } from './ScheduleDeployDialog';
import { matchScheduleApproval, ScheduleApprovalStatusText } from './ScheduleApprovalStatusText';

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const scheduleApi = vi.hoisted(() => ({ preview: vi.fn(), create: vi.fn(), resume: vi.fn(), meta: vi.fn() }));
vi.mock('../../../api/deploySchedules', () => ({ deploySchedulesApi: scheduleApi }));
const approvalApi = vi.hoisted(() => ({ getStatus: vi.fn(), createRequest: vi.fn() }));
vi.mock('../../../api/switchApprovals', () => ({ switchApprovalsApi: approvalApi }));
vi.mock('../../../api/validation', () => ({ testSetsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) } }));
vi.mock('../../../api/environment', () => ({ environmentApi: { history: vi.fn().mockResolvedValue({ items: [], total: 0 }) } }));

const SCHEDULE_ID = 'f0000000-0000-4000-8000-000000000001';
const FUTURE = new Date(Date.now() + 86_400_000);

function scheduleItem(overrides: Partial<DeployScheduleListItem> = {}): DeployScheduleListItem {
  return {
    id: SCHEDULE_ID,
    chatbotId: CHATBOT_ID,
    action: 'SWITCH_PROD_VERSION',
    status: 'PENDING',
    scheduledAt: FUTURE,
    targetVersionId: 'c0000000-0000-4000-8000-00000000000b',
    targetVersionNo: 13,
    enableWebChannel: null,
    channelEnabled: null,
    memo: null,
    createdByEmail: 'lee@example.com',
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    attemptCount: 0,
    lastTransientReason: null,
    delaySeconds: null,
    finishedAt: null,
    outcome: null,
    failureReason: null,
    heldReason: null,
    needsAttention: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({ can: () => true, user: { id: 'user-lee', email: 'lee@example.com', governanceModeOn: false } });
  Object.values(scheduleApi).forEach((fn) => fn.mockReset());
  Object.values(approvalApi).forEach((fn) => fn.mockReset());
  scheduleApi.meta.mockResolvedValue({ timezone: 'Asia/Seoul', engine: { enabledOnThisInstance: true, overduePendingCount: 0 } });
});

describe('matchScheduleApproval — 예약과 승인 요청 합성(§9.10 표)', () => {
  it('정책 꺼짐이면 아무것도 보이지 않는다', () => {
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus({ policy: { required: false, ttlHours: 24 } })).kind).toBe('NONE');
    expect(matchScheduleApproval(scheduleItem(), null).kind).toBe('NONE');
  });

  it('대기 요청·승인됨·반려/취소/만료·없음(승인 요청 필요)·확인 불가를 구분한다', () => {
    const pending = makeApproval({ deployScheduleId: SCHEDULE_ID, action: 'SCHEDULED_PROD_SWITCH' });
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus({ pending })).kind).toBe('PENDING');
    const approved = makeApproval({ id: 'a', deployScheduleId: SCHEDULE_ID, status: 'APPROVED', outcome: 'SCHEDULED' });
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus({ recent: [approved] })).kind).toBe('APPROVED');
    const rejected = makeApproval({ id: 'b', deployScheduleId: SCHEDULE_ID, status: 'REJECTED' });
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus({ recent: [rejected] })).kind).toBe('CLOSED');
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus()).kind).toBe('REQUIRED');
    expect(matchScheduleApproval(scheduleItem({ status: 'SUCCEEDED' }), makePolicyStatus()).kind).toBe('NONE');
    // recent 20건이 가득 찼고 예약 시각이 미래면 "없음"으로 단정하지 않는다.
    const full = Array.from({ length: 20 }, (_, i) => makeApproval({ id: `x${i}`, deployScheduleId: `other-${i}`, status: 'EXPIRED' }));
    expect(matchScheduleApproval(scheduleItem(), makePolicyStatus({ recent: full })).kind).toBe('UNKNOWN');
  });
});

describe('ScheduleApprovalStatusText / DeployScheduleRow — 예약 행의 승인 상태', () => {
  const renderStatus = (match: ReturnType<typeof matchScheduleApproval>, createdByEmail = 'lee@example.com', onSent = vi.fn()): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <ScheduleApprovalStatusText chatbotId={CHATBOT_ID} scheduleId={SCHEDULE_ID} createdByEmail={createdByEmail} match={match} onSent={onSent} />
        </ToastProvider>
      </MemoryRouter>,
    );

  it('대기: 만료 시각 글자와 "승인 요청 보기" 링크', () => {
    const request = makeApproval({ id: 'req-1', deployScheduleId: SCHEDULE_ID });
    renderStatus({ kind: 'PENDING', request });
    expect(screen.getByText(/^승인 대기\(만료 /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '승인 요청 보기' })).toHaveAttribute('href', `/environment-approvals/${CHATBOT_ID}/req-1`);
  });

  it('승인됨: "승인됨 — 예약 시각에 전환됩니다"', () => {
    renderStatus({ kind: 'APPROVED', request: makeApproval({ status: 'APPROVED', outcome: 'SCHEDULED' }) });
    expect(screen.getByText('승인됨 — 예약 시각에 전환됩니다')).toBeInTheDocument();
  });

  it('승인 요청 필요: 예약 작성자만 "승인 요청 보내기" 버튼을 보고, 누르면 예약 전환 요청을 만든다', async () => {
    const user = userEvent.setup();
    approvalApi.createRequest.mockResolvedValue({ id: 'new' });
    const onSent = vi.fn();
    renderStatus({ kind: 'REQUIRED' }, 'lee@example.com', onSent);
    expect(screen.getByText('승인 요청 필요 — 승인 요청이 없으면 실행되지 않습니다')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '승인 요청 보내기' }));
    await waitFor(() => expect(approvalApi.createRequest).toHaveBeenCalledWith(CHATBOT_ID, { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: SCHEDULE_ID }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it('작성자가 아니면 안내 글자만 있고 버튼이 없다', () => {
    renderStatus({ kind: 'REQUIRED' }, 'someone-else@example.com');
    expect(screen.getByText(/승인 요청 필요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인 요청 보내기' })).toBeNull();
  });

  it('반려·만료된 요청은 "다시 보내기"를 주고, 실패(예약 작성자 아님 403)는 토스트로 알린다', async () => {
    const user = userEvent.setup();
    approvalApi.createRequest.mockRejectedValue(new ApiError(403, 'x', 'FORBIDDEN' as never));
    renderStatus({ kind: 'CLOSED', request: makeApproval({ status: 'REJECTED' }) });
    expect(screen.getByText('승인 요청이 반려됨')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '승인 요청 다시 보내기' }));
    expect(await screen.findByText('예약을 만든 사람만 승인 요청을 보낼 수 있습니다.')).toBeInTheDocument();
  });

  it('확인 불가: 환경 탭에서 확인하라는 글자', () => {
    renderStatus({ kind: 'UNKNOWN' });
    expect(screen.getByText('승인 상태를 확인할 수 없습니다 — 환경 탭에서 확인하세요')).toBeInTheDocument();
  });

  it('행 컴포넌트: approvalSlot이 있으면 메타 줄에 함께 그리고, 실패 사유 APPROVAL_MISSING 라벨을 보인다', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <DeployScheduleRow
            item={scheduleItem({ status: 'FAILED', failureReason: 'APPROVAL_MISSING', needsAttention: true })}
            can={() => true}
            onRetry={vi.fn()}
            onAcknowledge={vi.fn()}
            onCancel={vi.fn()}
            detailHref="/x"
            approvalSlot={<span>승인 슬롯</span>}
          />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('승인 슬롯')).toBeInTheDocument();
    expect(screen.getByText('승인 없음(2인 승인 필요)')).toBeInTheDocument();
    expect(MESSAGES.deploySchedules.reasons.failure.APPROVAL_MISSING).toBe('승인 없음(2인 승인 필요)');
  });
});

describe('ScheduleDeployDialog — 2인 승인 켜진 챗봇의 예약 + 승인 요청(§9.10)', () => {
  const ENV: EnvironmentStatus = {
    enabled: true,
    enabledAt: new Date(),
    prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
    staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
    draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
    gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
    activeSwitchSchedule: null,
  } as EnvironmentStatus;

  const preview: DeploySchedulePreviewResponse = {
    creatable: true,
    preconditionFailures: [],
    timeViolations: [],
    readinessWarnings: [],
    switchProd: {
      base: 'CURRENT',
      expectedProdVersionId: 'ver-43',
      targetVersion: { id: 'ver-44', versionNo: 44 },
      gate: { verdict: 'PASS', reason: 'PASSED', run: null },
      blockers: [],
      warnings: [],
    },
  } as unknown as DeploySchedulePreviewResponse;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2027-01-15T00:00:00+09:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderDialog = (onCreated = vi.fn()): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <ScheduleDeployDialog
          chatbotId={CHATBOT_ID}
          isOpen
          onClose={vi.fn()}
          onCreated={onCreated}
          timezone="Asia/Seoul"
          chatbotStatus="ACTIVE"
          initialAction="SWITCH_PROD_VERSION"
          versionId="ver-44"
          versionNo={44}
          environmentStatus={ENV}
        />
      </MemoryRouter>,
    );

  async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(scheduleApi.preview).toHaveBeenCalled());
    return user;
  }

  it('정책 켜짐이면 안내를 보이고 확정 버튼이 "예약 + 승인 요청"이며, 예약 뒤 같은 흐름에서 승인 요청을 보낸다', async () => {
    scheduleApi.preview.mockResolvedValue(preview);
    approvalApi.getStatus.mockResolvedValue(makePolicyStatus());
    scheduleApi.create.mockResolvedValue({ schedule: { id: SCHEDULE_ID }, readinessWarnings: [] });
    approvalApi.createRequest.mockResolvedValue({ id: 'req-1' });
    const onCreated = vi.fn();
    renderDialog(onCreated);
    const user = await ready();
    expect(await screen.findByText(/예약을 만들면 승인 요청도 함께 보냅니다/)).toBeInTheDocument();
    const confirm = await screen.findByRole('button', { name: /v44 예약 \+ 승인 요청$/ });
    await user.click(confirm);
    await waitFor(() => expect(scheduleApi.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(approvalApi.createRequest).toHaveBeenCalledWith(CHATBOT_ID, { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: SCHEDULE_ID, reason: undefined }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.any(String), { approvalRequested: true }));
  });

  it('예약은 만들어졌지만 승인 요청이 실패하면 대화상자 안 결과 화면으로 전환한다(대기 중복 안내 포함)', async () => {
    scheduleApi.preview.mockResolvedValue(preview);
    approvalApi.getStatus.mockResolvedValue(makePolicyStatus());
    scheduleApi.create.mockResolvedValue({ schedule: { id: SCHEDULE_ID }, readinessWarnings: [] });
    approvalApi.createRequest.mockRejectedValue(new ApiError(409, 'x', 'APPROVAL_PENDING_EXISTS' as never, [{ field: 'requestId', message: 'req-9' }]));
    const onCreated = vi.fn();
    renderDialog(onCreated);
    const user = await ready();
    await user.click(await screen.findByRole('button', { name: /v44 예약 \+ 승인 요청$/ }));
    expect(await screen.findByText(/예약은 만들어졌지만 승인 요청을 보내지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/승인 요청이 없으면 예약 시각에 전환되지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/승인을 기다리는 요청이 이미 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '대기 중인 요청 보기' })).toHaveAttribute('href', `/environment-approvals/${CHATBOT_ID}/req-9`);
    expect(screen.getByRole('link', { name: '예약 배포에서 보기' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/deploy-schedules/${SCHEDULE_ID}`);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('닫기', { selector: 'button.btn' }));
    expect(onCreated).toHaveBeenCalledWith(expect.any(String), { approvalRequested: false });
  });

  it('예약 생성이 실패하면 승인 요청은 보내지 않는다', async () => {
    scheduleApi.preview.mockResolvedValue(preview);
    approvalApi.getStatus.mockResolvedValue(makePolicyStatus());
    scheduleApi.create.mockRejectedValue(new ApiError(409, '실패', 'DEPLOY_SCHEDULE_LIMIT_EXCEEDED' as never));
    renderDialog();
    const user = await ready();
    await user.click(await screen.findByRole('button', { name: /v44 예약 \+ 승인 요청$/ }));
    await waitFor(() => expect(scheduleApi.create).toHaveBeenCalled());
    expect(approvalApi.createRequest).not.toHaveBeenCalled();
  });

  it('정책 꺼짐이면 기존 문구·기존 흐름 그대로다(승인 요청을 보내지 않는다)', async () => {
    scheduleApi.preview.mockResolvedValue(preview);
    approvalApi.getStatus.mockResolvedValue(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    scheduleApi.create.mockResolvedValue({ schedule: { id: SCHEDULE_ID }, readinessWarnings: [] });
    const onCreated = vi.fn();
    renderDialog(onCreated);
    const user = await ready();
    await user.click(await screen.findByRole('button', { name: /에 v44으로 운영 전환 예약$/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.any(String)));
    expect(approvalApi.createRequest).not.toHaveBeenCalled();
    expect(screen.queryByText(/승인 요청도 함께 보냅니다/)).toBeNull();
  });
});
