import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EnvironmentGateSettings, ProdSwitchApprovalDetail, ProdSwitchPreviewResponse } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { CHATBOT_ID, makeApproval, REQUEST_ID, VERSION_A, VERSION_B } from '../../chatbot-detail/guardrails/testFixtures';
import { ApprovalDetailPage } from './ApprovalDetailPage';
import { ApprovalListPage } from './ApprovalListPage';

expect.extend(toHaveNoViolations);

let mockCan: (p: string) => boolean = () => true;
let mockUserId = 'user-lee';
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => mockCan(p), user: { id: mockUserId, email: 'lee@example.com', governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({ listGlobal: vi.fn(), getRequest: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() }));
vi.mock('../../../api/switchApprovals', () => ({ switchApprovalsApi: api }));
const envApi = vi.hoisted(() => ({ getStatus: vi.fn() }));
vi.mock('../../../api/environment', () => ({ environmentApi: envApi }));

const GATE: EnvironmentGateSettings = { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 };

function livePreview(overrides: Partial<ProdSwitchPreviewResponse> = {}): ProdSwitchPreviewResponse {
  return {
    kind: 'SWITCH',
    current: { versionId: VERSION_A, versionNo: 12, capturedAt: new Date('2026-09-20T00:00:00.000Z'), label: null },
    target: { versionId: VERSION_B, versionNo: 13, capturedAt: new Date('2026-09-24T00:00:00.000Z'), label: null },
    expectedProdVersionId: VERSION_A,
    outcome: 'SWITCHABLE',
    diffSummary: { rows: [], totalChanged: 14, identical: false },
    gate: { verdict: 'PASS', reason: 'PASSED', run: { runId: 'r', setId: 's', setName: '정기 회귀', passRate: 0.98, finishedAt: new Date('2026-09-25T04:50:00.000Z') } },
    blockers: [],
    warnings: [],
    ...overrides,
  } as ProdSwitchPreviewResponse;
}

function detail(overrides: Partial<ProdSwitchApprovalDetail> = {}): ProdSwitchApprovalDetail {
  return { ...makeApproval(), livePreview: livePreview(), ...overrides } as ProdSwitchApprovalDetail;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  envApi.getStatus.mockReset();
  envApi.getStatus.mockResolvedValue({ enabled: true, gate: GATE });
  mockCan = () => true;
  mockUserId = 'user-lee';
});

describe('AP-1 운영 전환 승인 목록', () => {
  const renderList = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <ApprovalListPage />
      </MemoryRouter>,
    );

  it('표에 챗봇·동작·대상←기준·요청자·게이트·경고·만료까지·상태·내가 할 일을 글자로 보이고 상세 링크만 준다', async () => {
    api.listGlobal.mockResolvedValue({
      items: [makeApproval(), makeApproval({ id: 'r2', chatbotName: '환불 봇', canApprove: false, canCancel: true }), makeApproval({ id: 'r3', status: 'EXPIRED', canApprove: false })],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    renderList();
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getByRole('columnheader', { name: '내가 할 일' })).toBeInTheDocument();
    expect(within(table).getByText('승인하거나 반려할 수 있습니다')).toBeInTheDocument();
    expect(within(table).getByText('내가 요청한 건입니다')).toBeInTheDocument();
    expect(within(table).getAllByText('v13 ← v12').length).toBe(3);
    expect(within(table).getByText('기한이 지나 만료됨')).toBeInTheDocument();
    expect(within(table).getAllByText('2건').length).toBe(3);
    const link = within(table).getAllByRole('link', { name: '주문 상담봇 승인 요청 자세히 보기' })[0];
    expect(link).toHaveAttribute('href', `/environment-approvals/${CHATBOT_ID}/${REQUEST_ID}`);
    // 목록에서 바로 승인하는 버튼은 없다.
    expect(within(table).queryByRole('button', { name: /승인/ })).toBeNull();
    expect(screen.getByText('승인 요청 3건', { selector: '[role="status"]' })).toBeInTheDocument();
  });

  it('보기는 "적용" 버튼으로만 바뀌고 전체 보기는 status=ALL로 다시 조회한다', async () => {
    const user = userEvent.setup();
    api.listGlobal.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderList();
    expect(await screen.findByText('승인을 기다리는 요청이 없습니다.')).toBeInTheDocument();
    expect(api.listGlobal).toHaveBeenLastCalledWith({ status: 'PENDING', page: 1, pageSize: 20 });
    await user.click(screen.getByRole('radio', { name: '전체(최근)' }));
    expect(api.listGlobal).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '적용' }));
    await waitFor(() => expect(api.listGlobal).toHaveBeenLastCalledWith({ status: 'ALL', page: 1, pageSize: 20 }));
    expect(await screen.findByText('승인 요청 기록이 없습니다.')).toBeInTheDocument();
  });

  it('조회 실패는 ErrorState와 다시 시도', async () => {
    const user = userEvent.setup();
    api.listGlobal.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderList();
    expect(await screen.findByText('승인 요청을 불러오지 못했습니다')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('승인을 기다리는 요청이 없습니다.')).toBeInTheDocument();
  });

  it('axe: 목록 화면에 구조적 접근성 위반이 없다', async () => {
    api.listGlobal.mockResolvedValue({ items: [makeApproval(), makeApproval({ id: 'r2', canApprove: false, canCancel: true })], total: 2, page: 1, pageSize: 20 });
    const { container } = renderList();
    await screen.findAllByRole('table');
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('AP-2 승인 요청 상세', () => {
  const renderDetail = (): ReturnType<typeof render> =>
    render(
      <MemoryRouter initialEntries={[`/environment-approvals/${CHATBOT_ID}/${REQUEST_ID}`]}>
        <ToastProvider>
          <Routes>
            <Route path="/environment-approvals/:chatbotId/:requestId" element={<ApprovalDetailPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );

  it('요청 내용(dl)과 "지금 기준으로 다시 확인한 내용"(차이·시험 기준)을 보인다', async () => {
    api.getRequest.mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByRole('heading', { name: '운영 전환 승인 요청' })).toBeInTheDocument();
    expect(screen.getByText('승인 대기')).toBeInTheDocument();
    expect(screen.getByText('주문 상담봇')).toBeInTheDocument();
    expect(screen.getByText('v13')).toBeInTheDocument();
    expect(screen.getByText('v12')).toBeInTheDocument();
    expect(screen.getByText('10월 안내문 교체')).toBeInTheDocument();
    expect(screen.getByText('지금 기준으로 다시 확인한 내용')).toBeInTheDocument();
    expect(screen.getByText(/승인하면 이 내용 기준으로 진행됩니다/)).toBeInTheDocument();
    expect(screen.getByText('현재 운영 v12 → 대상 v13')).toBeInTheDocument();
  });

  it('승인: 확인 대화상자(기본 포커스 취소)를 거쳐 approve를 호출하고 적용 결과 배너를 보인다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail());
    api.approve.mockResolvedValue({ request: makeApproval({ status: 'APPROVED', outcome: 'APPLIED', canApprove: false, decidedBy: { id: 'user-lee', email: 'lee@example.com' }, decidedAt: new Date() }), switch: null });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '승인하고 운영에 적용' }));
    const dialog = await screen.findByRole('dialog', { name: '승인' });
    expect(within(dialog).getByText('v13을 운영에 바로 적용합니다. 계속할까요?')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(CHATBOT_ID, REQUEST_ID, {}));
    expect(await screen.findByText('v13을 운영에 적용했습니다.')).toBeInTheDocument();
    expect(screen.getByText('승인됨 · 운영에 적용됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인하고 운영에 적용' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { name: '상태' })).toHaveFocus());
  });

  it('경고가 있으면 확인 체크가 필수이고 미체크 승인은 인라인 오류로 막는다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail({ livePreview: livePreview({ warnings: [{ code: 'LEGACY_TIEBREAK' }] as never }) }));
    api.approve.mockResolvedValue({ request: makeApproval({ status: 'APPROVED', outcome: 'APPLIED' }), switch: null });
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '승인하고 운영에 적용' }));
    expect(await screen.findByText('경고를 확인했는지 체크해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: '위 경고를 확인했습니다' }));
    await user.click(screen.getByRole('button', { name: '승인하고 운영에 적용' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(CHATBOT_ID, REQUEST_ID, { acknowledgeWarnings: true }));
  });

  it('차단 사유가 있으면 승인은 aria-disabled + 이유 글자이고 반려는 계속 가능하다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail({ livePreview: livePreview({ blockers: ['GATE_BLOCKED'], gate: { verdict: 'BLOCK', reason: 'NO_RUN', run: null } }) }));
    renderDetail();
    const approve = await screen.findByRole('button', { name: '승인하고 운영에 적용' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription(/지금 기준으로 .* 승인해도 적용되지 않습니다\. 반려하거나, 시험을 다시 실행한 뒤 요청자에게 새로 요청하도록 안내하세요\./);
    await user.click(approve);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.approve).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '반려…' })).not.toHaveAttribute('aria-disabled');
  });

  describe('롤백 요청의 게이트 BLOCK(N40-1)', () => {
    const blockedLive = (extra: Partial<ProdSwitchPreviewResponse>): ProdSwitchPreviewResponse =>
      livePreview({ kind: 'ROLLBACK', blockers: ['GATE_BLOCKED'], gate: { verdict: 'BLOCK', reason: 'NO_RUN', run: null }, ...extra });

    it('직전 운영 버전 롤백(directRollback=true)이면 BLOCK이 경고로 완화되어 승인할 수 있다', async () => {
      api.getRequest.mockResolvedValue(detail({ action: 'PROD_ROLLBACK', livePreview: blockedLive({ directRollback: true }) }));
      renderDetail();
      const approve = await screen.findByRole('button', { name: '승인하고 운영에 적용' });
      expect(approve).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByText(/승인해도 적용되지 않습니다/)).toBeNull();
    });

    it('직전이 아닌 롤백(directRollback=false)이면 일반 전환처럼 승인이 aria-disabled + 차단 사유로 막힌다', async () => {
      const user = userEvent.setup();
      api.getRequest.mockResolvedValue(detail({ action: 'PROD_ROLLBACK', livePreview: blockedLive({ directRollback: false }) }));
      renderDetail();
      const approve = await screen.findByRole('button', { name: '승인하고 운영에 적용' });
      expect(approve).toHaveAttribute('aria-disabled', 'true');
      expect(approve).toHaveAccessibleDescription(/승인해도 적용되지 않습니다/);
      await user.click(approve);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.approve).not.toHaveBeenCalled();
    });

    it('전환(SWITCH) 요청은 directRollback 키와 무관하게 기존대로 BLOCK이 막는다', async () => {
      api.getRequest.mockResolvedValue(detail({ livePreview: blockedLive({ kind: 'SWITCH' }) }));
      renderDetail();
      expect(await screen.findByRole('button', { name: '승인하고 운영에 적용' })).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('본인이 요청한 건: 승인·반려는 aria-disabled + 이유이고 "요청 취소"만 쓸 수 있다', async () => {
    const user = userEvent.setup();
    mockUserId = 'user-kim';
    api.getRequest.mockResolvedValue(detail({ canApprove: false, canCancel: true }));
    api.cancel.mockResolvedValue(makeApproval({ status: 'CANCELLED', closedReason: 'REQUESTER' }));
    renderDetail();
    const approve = await screen.findByRole('button', { name: '승인하고 운영에 적용' });
    const reject = screen.getByRole('button', { name: '반려…' });
    for (const b of [approve, reject]) {
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).toHaveAccessibleDescription(/본인이 요청한 건은 승인하거나 반려할 수 없습니다\. 다른 관리자에게 승인을 요청해 주세요\./);
    }
    await user.click(approve);
    expect(api.approve).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '요청 취소' }));
    const dialog = await screen.findByRole('dialog', { name: '승인 요청 취소' });
    expect(within(dialog).getByText('닫기', { selector: 'button.btn' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '요청 취소' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(CHATBOT_ID, REQUEST_ID));
    expect(await screen.findByText('요청자가 취소함')).toBeInTheDocument();
  });

  it('반려: 사유(선택, 200자)를 받는 대화상자의 기본 포커스는 취소이고 note와 함께 reject를 호출한다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail());
    api.reject.mockResolvedValue(makeApproval({ status: 'REJECTED', decisionNote: '문구 재확인', canApprove: false }));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '반려…' }));
    const dialog = await screen.findByRole('dialog', { name: '승인 요청 반려' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(within(dialog).getByText('0/200')).toBeInTheDocument();
    expect(within(dialog).getByText(/사유는 요청자가 볼 수 있습니다\. 개인정보는 적지 마세요\./)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('반려 사유(선택)'), '문구 재확인');
    expect(within(dialog).getByText('6/200')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '반려하기' }));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith(CHATBOT_ID, REQUEST_ID, { note: '문구 재확인' }));
    expect(await screen.findByText('반려했습니다.')).toBeInTheDocument();
    expect(screen.getByText('반려됨')).toBeInTheDocument();
  });

  it('승인이 409(이미 다른 관리자가 처리)면 안내를 보이고 상세를 다시 조회해 종결 상태를 그린다', async () => {
    const user = userEvent.setup();
    api.getRequest
      .mockResolvedValueOnce(detail())
      .mockResolvedValue({ ...makeApproval({ status: 'APPROVED', outcome: 'APPLIED', canApprove: false }), livePreview: null });
    api.approve.mockRejectedValue(new ApiError(409, 'x', 'APPROVAL_NOT_PENDING' as never, [{ field: 'status', message: 'APPROVED' }]));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '승인하고 운영에 적용' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '승인' }));
    expect(await screen.findByText('이미 다른 관리자가 승인했습니다. 최신 상태를 불러왔습니다.')).toBeInTheDocument();
    await waitFor(() => expect(api.getRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('승인됨 · 운영에 적용됨')).toBeInTheDocument();
    expect(screen.getByText(/이 요청은 이미 종료되어 승인·반려할 수 없습니다/)).toBeInTheDocument();
  });

  it('승인 뒤 적용 실패(시험 기준 미달)는 "승인은 기록되었지만…" 배너를 보이고 결과를 다시 조회한다', async () => {
    const user = userEvent.setup();
    api.getRequest
      .mockResolvedValueOnce(detail())
      .mockResolvedValue({ ...makeApproval({ status: 'APPROVED', outcome: 'FAILED', failureCode: 'ENV_GATE_NOT_PASSED', canApprove: false }), livePreview: null });
    api.approve.mockRejectedValue(new ApiError(409, 'x', 'ENV_GATE_NOT_PASSED' as never, [{ field: 'requestStatus', message: 'APPROVED' }, { field: 'outcome', message: 'FAILED' }]));
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '승인하고 운영에 적용' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '승인' }));
    expect(await screen.findByText(/승인은 기록되었지만 필수 시험 기준을 충족하지 못해 운영에 적용하지 못했습니다\. 운영은 바뀌지 않았습니다\./)).toBeInTheDocument();
    expect(await screen.findByText('승인됨 · 적용 실패(필수 시험 기준 미달)')).toBeInTheDocument();
  });

  it('예약 전환 요청은 예약 시각과 링크를 보이고 승인 문구·확인 문구가 예약용이다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail({ action: 'SCHEDULED_PROD_SWITCH', scheduledAt: new Date('2026-10-05T00:00:00.000Z'), deployScheduleId: 'f0000000-0000-4000-8000-000000000001' }));
    renderDetail();
    expect(await screen.findByRole('link', { name: '예약 배포에서 보기 →' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/deploy-schedules/f0000000-0000-4000-8000-000000000001`);
    await user.click(screen.getByRole('button', { name: '승인하기(예약 시각에 전환)' }));
    expect(await screen.findByText(/승인 시점에는 운영이 바뀌지 않습니다/)).toBeInTheDocument();
  });

  it('요청자 계정이 비활성이면 글자로 알리고, 없는 요청(404)은 빈 상태 안내', async () => {
    api.getRequest.mockResolvedValueOnce(detail({ requestedBy: { id: 'u9', email: 'gone@example.com', active: false } }));
    const first = renderDetail();
    expect(await screen.findByText(/\(계정 비활성\)/)).toBeInTheDocument();
    first.unmount();
    api.getRequest.mockRejectedValue(new ApiError(404, 'x', 'NOT_FOUND' as never));
    renderDetail();
    expect(await screen.findByText('이 승인 요청을 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('종결된 요청은 다시 확인 영역 대신 종결 안내만 보이고 승인·반려 버튼이 없다', async () => {
    api.getRequest.mockResolvedValue({ ...makeApproval({ status: 'EXPIRED', canApprove: false }), livePreview: null });
    renderDetail();
    expect(await screen.findByText('기한이 지나 만료됨')).toBeInTheDocument();
    expect(screen.queryByText('지금 기준으로 다시 확인한 내용')).toBeNull();
    expect(screen.queryByRole('button', { name: '반려…' })).toBeNull();
  });

  it('배포 권한이 없으면(읽기 전용) 승인·반려·취소 컨트롤을 렌더하지 않는다', async () => {
    mockCan = (p) => p !== 'chatbot:deploy';
    api.getRequest.mockResolvedValue(detail());
    renderDetail();
    await screen.findByText('지금 기준으로 다시 확인한 내용');
    expect(screen.queryByRole('button', { name: '승인하고 운영에 적용' })).toBeNull();
    expect(screen.queryByRole('button', { name: '반려…' })).toBeNull();
  });

  it('axe: 상세 화면과 반려 대화상자에 구조적 접근성 위반이 없다', async () => {
    const user = userEvent.setup();
    api.getRequest.mockResolvedValue(detail({ livePreview: livePreview({ warnings: [{ code: 'LEGACY_TIEBREAK' }] as never }) }));
    const { container } = renderDetail();
    await screen.findByText('지금 기준으로 다시 확인한 내용');
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: '반려…' }));
    await screen.findByRole('dialog', { name: '승인 요청 반려' });
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
