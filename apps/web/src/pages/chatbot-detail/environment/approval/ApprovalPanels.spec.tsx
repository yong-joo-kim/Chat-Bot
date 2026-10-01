import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../../../api/client';
import { ToastProvider } from '../../../../components/Toast';
import { CHATBOT_ID, makeApproval, makePolicyStatus, REQUEST_ID } from '../../guardrails/testFixtures';
import { ApprovalPendingCard } from './ApprovalPendingCard';
import { ApprovalPolicyPanel } from './ApprovalPolicyPanel';
import { remainingLabel } from './RemainingTimeText';

expect.extend(toHaveNoViolations);

let mockCan: (p: string) => boolean = () => true;
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => mockCan(p), user: { id: 'user-lee', email: 'lee@example.com', governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({ updatePolicy: vi.fn(), cancel: vi.fn() }));
vi.mock('../../../../api/switchApprovals', () => ({ switchApprovalsApi: api }));

function renderPanel(status = makePolicyStatus({ policy: { required: false, ttlHours: 24 } }), extra: { archived?: boolean; onChanged?: () => void } = {}): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ApprovalPolicyPanel chatbotId={CHATBOT_ID} status={status} archived={extra.archived ?? false} onChanged={extra.onChanged ?? (() => undefined)} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  mockCan = () => true;
});

describe('ApprovalPolicyPanel — 운영 전환 2인 승인 설정', () => {
  it('꺼짐 상태: 글자(○ 꺼짐)와 개념 안내·승인 가능자 수를 보이고 스위치는 대화상자를 연다', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('heading', { name: '운영 전환 2인 승인' })).toBeInTheDocument();
    expect(screen.getByText(/꺼짐 — 운영 전환은 배포 권한이 있는 한 사람의 확인만으로 실행됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/직전 운영 버전으로 되돌리기는 긴급 복구를 위해 승인 없이 바로 실행되고 기록이 남습니다/)).toBeInTheDocument();
    expect(screen.getByText('승인할 수 있는 다른 관리자: 2명')).toBeInTheDocument();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent('꺼짐');
    await user.click(toggle);
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 켜기' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(within(dialog).getByLabelText('승인 유효 시간(시간)')).toHaveValue(24);
  });

  it('켜기 확인 대화상자에 "켠 뒤 끄지 못할 수 있다" 일반 안내가 있고, 기본 포커스는 취소이며 axe 위반이 없다 (N36-1)', async () => {
    const user = userEvent.setup();
    renderPanel(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 켜기' });
    expect(within(dialog).getByText('서버 설정에 따라 켠 뒤에는 끄지 못할 수 있습니다.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(await axe(dialog, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });

  it('끄기 확인 대화상자에는 그 안내가 없다', async () => {
    const user = userEvent.setup();
    renderPanel(makePolicyStatus());
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 끄기' });
    expect(within(dialog).queryByText('서버 설정에 따라 켠 뒤에는 끄지 못할 수 있습니다.')).not.toBeInTheDocument();
  });

  it('켜기: 만료 시간을 검증(1~168)하고 PUT {required:true, ttlHours}로 켠다', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    api.updatePolicy.mockResolvedValue(makePolicyStatus());
    renderPanel(undefined, { onChanged });
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 켜기' });
    const input = within(dialog).getByLabelText('승인 유효 시간(시간)');
    await user.clear(input);
    await user.type(input, '200');
    await user.click(within(dialog).getByRole('button', { name: '2인 승인 켜기' }));
    expect(await within(dialog).findByText('1~168 사이의 숫자를 입력해 주세요.')).toBeInTheDocument();
    expect(api.updatePolicy).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '48');
    await user.click(within(dialog).getByRole('button', { name: '2인 승인 켜기' }));
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledWith(CHATBOT_ID, { required: true, ttlHours: 48 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((await screen.findAllByText('운영 전환 2인 승인을 켰습니다.')).length).toBeGreaterThan(0);
  });

  it('켜기 불가: 활성 관리자가 2명 미만이면 aria-disabled + 이유 글자이고 대화상자를 열지 않는다', async () => {
    const user = userEvent.setup();
    renderPanel(makePolicyStatus({ policy: { required: false, ttlHours: 24 }, eligibleApproverCount: 1, otherApproverCount: 0 }));
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAccessibleDescription('활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다(지금 1명).');
    await user.click(toggle);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('켜짐 + 다른 승인 가능 관리자 0명이면 경고 배너(자동으로 끄지 않음)와 회원 관리 링크를 보인다', () => {
    renderPanel(makePolicyStatus({ otherApproverCount: 0, eligibleApproverCount: 1 }));
    expect(screen.getByText(/승인할 수 있는 다른 관리자가 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '회원 관리' })).toHaveAttribute('href', '/settings/users');
    expect(screen.getByText('켜짐 — 요청한 뒤 24시간 안에 다른 관리자가 승인해야 합니다.')).toBeInTheDocument();
  });

  it('끄기: 확인 대화상자(기본 포커스 취소)를 거치고 대기 요청이 취소된다는 안내를 보인다', async () => {
    const user = userEvent.setup();
    api.updatePolicy.mockResolvedValue(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    renderPanel(makePolicyStatus({ pending: makeApproval() }));
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 끄기' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    expect(within(dialog).getByText('지금 대기 중인 요청 1건이 취소됩니다.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '2인 승인 끄기' }));
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledWith(CHATBOT_ID, { required: false, ttlHours: 24 }));
    expect((await screen.findAllByText('운영 전환 2인 승인을 껐습니다. 대기 중이던 요청은 취소되었습니다.')).length).toBeGreaterThan(0);
  });

  it('끄기 잠금(offLocked)은 aria-disabled + 🔒 + 이유이고, 보관 챗봇은 바꿀 수 없다는 이유로 잠긴다', () => {
    const { unmount } = renderPanel(makePolicyStatus({ offLocked: true }));
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAccessibleDescription('서버 설정으로 2인 승인 끄기가 잠겨 있습니다. 서버 관리자에게 문의해 주세요.');
    unmount();
    renderPanel(makePolicyStatus(), { archived: true });
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('보관된 챗봇은 바꿀 수 없습니다.');
  });

  it('끄기 잠금 원인에 따라 문구가 갈린다 — GOVERNANCE_MODE는 거버넌스 문구, SERVER_SETTING은 기존 문구, 키 없음(잠금 아님)은 이유 없음', () => {
    const governance = '데이터 거버넌스 모드에서는 2인 승인 끄기가 기본으로 잠겨 있습니다. 끄려면 서버 관리자에게 문의해 주세요.';
    const server = '서버 설정으로 2인 승인 끄기가 잠겨 있습니다. 서버 관리자에게 문의해 주세요.';
    const first = renderPanel(makePolicyStatus({ offLocked: true, offLockedBy: 'GOVERNANCE_MODE' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(governance);
    first.unmount();
    const second = renderPanel(makePolicyStatus({ offLocked: true, offLockedBy: 'SERVER_SETTING' }));
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(server);
    second.unmount();
    renderPanel(makePolicyStatus());
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(governance)).not.toBeInTheDocument();
    expect(screen.queryByText(server)).not.toBeInTheDocument();
  });

  it('승인 유효 시간 변경은 새 요청부터 적용된다는 안내와 함께 PUT한다', async () => {
    const user = userEvent.setup();
    api.updatePolicy.mockResolvedValue(makePolicyStatus({ policy: { required: true, ttlHours: 72 } }));
    renderPanel(makePolicyStatus());
    await user.click(screen.getByRole('button', { name: '승인 유효 시간 변경' }));
    const input = screen.getByLabelText('승인 유효 시간(시간)');
    expect(screen.getByText(/새로 보내는 요청부터 적용됩니다/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '72');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledWith(CHATBOT_ID, { required: true, ttlHours: 72 }));
  });

  it('배포 권한이 없으면 상태·승인 가능자·최근 요청만 글자로 보이고 컨트롤은 렌더하지 않는다', () => {
    mockCan = (p) => p !== 'chatbot:deploy';
    renderPanel(makePolicyStatus({ recent: [makeApproval({ status: 'APPROVED', outcome: 'APPLIED', decidedBy: { id: 'u2', email: 'park@example.com' } })] }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: '승인 유효 시간 변경' })).toBeNull();
    expect(screen.getByText('읽기 전용입니다. 정책을 바꾸려면 배포 권한이 필요합니다.')).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByText('승인됨 · 운영에 적용됨')).toBeInTheDocument();
    expect(within(table).getByText('park@example.com')).toBeInTheDocument();
  });

  it('최근 요청이 없으면 "아직 승인 요청이 없습니다."', () => {
    renderPanel();
    expect(screen.getByText('아직 승인 요청이 없습니다.')).toBeInTheDocument();
  });

  it('정책 켜기가 409(활성 관리자 부족)면 이유를 대화상자 안에 보인다', async () => {
    const user = userEvent.setup();
    api.updatePolicy.mockRejectedValue(new ApiError(409, 'x', 'APPROVAL_POLICY_UNAVAILABLE' as never, [{ field: 'reason', message: 'NOT_ENOUGH_APPROVERS' }]));
    renderPanel();
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('dialog', { name: '운영 전환 2인 승인 켜기' });
    await user.click(within(dialog).getByRole('button', { name: '2인 승인 켜기' }));
    expect(await within(dialog).findByText('활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다.')).toBeInTheDocument();
  });
});

describe('ApprovalPendingCard — 승인 대기 요청(제안 · 승인 전)', () => {
  const renderCard = (request = makeApproval(), onChanged = vi.fn()): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <ApprovalPendingCard chatbotId={CHATBOT_ID} request={request} onChanged={onChanged} />
        </ToastProvider>
      </MemoryRouter>,
    );

  it('제안-자산 분리 컨테이너 제목·상시 안내·요청 정보를 글자로 보인다', () => {
    renderCard();
    expect(screen.getByText('승인 대기 요청 (제안 · 승인 전)')).toBeInTheDocument();
    expect(screen.getByText(/승인될 때까지 운영 챗봇에는 아무 영향이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText('운영 전환 요청')).toBeInTheDocument();
    expect(screen.getByText(/v12\(현재 운영\) → v13/)).toBeInTheDocument();
    expect(screen.getByText('경고 2건 · 바뀌는 항목 14개')).toBeInTheDocument();
    expect(screen.getByText(/kim@example.com/)).toBeInTheDocument();
    expect(screen.getByText('사유: “10월 안내문 교체”')).toBeInTheDocument();
    expect(screen.getByText(/23시간 1\d분 남음/)).toBeInTheDocument();
  });

  it('다른 관리자는 상세에서만 승인하도록 링크(자세히 보기 · 승인하기)만 준다(목록에서 바로 승인 없음)', () => {
    renderCard();
    const link = screen.getByRole('link', { name: '자세히 보기 · 승인하기' });
    expect(link).toHaveAttribute('href', `/environment-approvals/${CHATBOT_ID}/${REQUEST_ID}`);
    expect(screen.queryByRole('button', { name: /^승인/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '요청 취소' })).toBeNull();
  });

  it('요청자 본인은 안내 문장과 "요청 취소"를 본다 — 취소 확인 대화상자의 기본 포커스는 "닫기"', async () => {
    const user = userEvent.setup();
    api.cancel.mockResolvedValue(makeApproval({ status: 'CANCELLED', closedReason: 'REQUESTER' }));
    const onChanged = vi.fn();
    renderCard(makeApproval({ canApprove: false, canCancel: true }), onChanged);
    expect(screen.getByText(/본인이 요청한 건입니다 — 다른 관리자의 승인을 기다리는 중입니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '요청 취소' }));
    const dialog = await screen.findByRole('dialog', { name: '승인 요청 취소' });
    expect(within(dialog).getByText(/취소하면 운영은 바뀌지 않습니다/)).toBeInTheDocument();
    expect(within(dialog).getByText('닫기', { selector: 'button.btn' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '요청 취소' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(CHATBOT_ID, REQUEST_ID));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('취소가 409(이미 처리됨)면 안내를 알리고 새로 불러온다', async () => {
    const user = userEvent.setup();
    api.cancel.mockRejectedValue(new ApiError(409, 'x', 'APPROVAL_NOT_PENDING' as never, [{ field: 'status', message: 'APPROVED' }]));
    const onChanged = vi.fn();
    renderCard(makeApproval({ canApprove: false, canCancel: true }), onChanged);
    await user.click(screen.getByRole('button', { name: '요청 취소' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '요청 취소' }));
    expect(await screen.findByText('이미 다른 관리자가 승인했습니다. 최신 상태를 불러왔습니다.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('요청자 계정이 비활성이면 글자로 표시하고 승인은 그대로 가능하다는 안내를 보인다', () => {
    renderCard(makeApproval({ requestedBy: { id: 'u9', email: 'gone@example.com', active: false } }));
    expect(screen.getByText(/\(계정 비활성\)/)).toBeInTheDocument();
    expect(screen.getByText('요청자 계정이 비활성이어도 요청은 그대로 승인할 수 있습니다.')).toBeInTheDocument();
  });

  it('남은 시간이 10분 미만이면 "곧 만료됩니다"와 경고 글자 배지를, 지났으면 새로 고침 안내를 보인다', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    expect(remainingLabel(new Date('2026-10-01T00:04:00.000Z'), now)).toBe('곧 만료됩니다(4분 남음)');
    expect(remainingLabel(new Date('2026-10-01T00:30:00.000Z'), now)).toBe('30분 남음');
    expect(remainingLabel(new Date('2026-10-01T23:12:00.000Z'), now)).toBe('23시간 12분 남음');
    const { unmount } = renderCard(makeApproval({ expiresAt: new Date(Date.now() + 4 * 60_000) }));
    expect(screen.getByText('곧 만료')).toBeInTheDocument();
    unmount();
    renderCard(makeApproval({ expiresAt: new Date(Date.now() - 60_000) }));
    expect(screen.getByText(/만료되었습니다\. 새로 고치면 사라집니다\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeInTheDocument();
  });
});
