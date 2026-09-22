import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordForm } from './ChangePasswordForm';
import { ApiError } from '../../api/client';
import { makeCurrentUser } from '../../test/fixtures';

const mockChangePassword = vi.fn();
const mockRefreshMe = vi.fn();
const mockLogout = vi.fn();

vi.mock('../../api/auth', () => ({
  authApi: { changePassword: (...args: unknown[]) => mockChangePassword(...args) },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: makeCurrentUser(), refreshMe: mockRefreshMe, logout: mockLogout }),
}));

async function fillAndSubmit(current: string, next: string, confirm = next): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('현재 비밀번호 *'), current);
  await user.type(screen.getByLabelText('새 비밀번호 *'), next);
  await user.type(screen.getByLabelText('새 비밀번호 확인 *'), confirm);
  await user.click(screen.getByRole('button', { name: '변경하고 계속하기' }));
}

/**
 * `ChangePasswordForm`의 401 코드 분기 자동시험 — 2차 코드리뷰 Low 관찰사항(a) 커버.
 * `INVALID_CREDENTIALS`(현재 비밀번호 실제 불일치)와 `SESSION_EXPIRED`/`ACCOUNT_DISABLED`
 * (세션 문제로 인한 401)를 서버 코드로 구분해 서로 다른 UX(필드 오류 vs 강제 로그아웃)로
 * 이어지는지 검증한다 — EX-12-8.
 */
describe('ChangePasswordForm — 401 코드 분기(EX-12-8)', () => {
  beforeEach(() => {
    mockChangePassword.mockReset();
    mockRefreshMe.mockReset();
    mockLogout.mockReset();
  });

  it('INVALID_CREDENTIALS는 "현재 비밀번호" 필드 오류로 표시되고 로그아웃되지 않는다', async () => {
    mockChangePassword.mockRejectedValue(new ApiError(401, '틀림', 'INVALID_CREDENTIALS'));
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={vi.fn()} />);

    await fillAndSubmit('wrong-current-pw', 'New-Password#123');

    await waitFor(() => expect(screen.getByText('현재 비밀번호가 올바르지 않습니다.')).toBeInTheDocument());
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('SESSION_EXPIRED(401)는 "현재 비밀번호 오류"로 오인시키지 않고 즉시 로그아웃한다', async () => {
    mockChangePassword.mockRejectedValue(new ApiError(401, '세션 만료', 'SESSION_EXPIRED'));
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={vi.fn()} />);

    await fillAndSubmit('current-pw', 'New-Password#123');

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('현재 비밀번호가 올바르지 않습니다.')).not.toBeInTheDocument();
  });

  it('ACCOUNT_DISABLED(401)도 SESSION_EXPIRED와 동일하게 즉시 로그아웃한다(관리자가 변경 도중 계정을 비활성화한 경우)', async () => {
    mockChangePassword.mockRejectedValue(new ApiError(401, '비활성화됨', 'ACCOUNT_DISABLED'));
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={vi.fn()} />);

    await fillAndSubmit('current-pw', 'New-Password#123');

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('코드 없는 예상 밖 401은 "현재 비밀번호" 필드에 서버 메시지를 폴백 표시한다(로그아웃하지 않음)', async () => {
    mockChangePassword.mockRejectedValue(new ApiError(401, '알 수 없는 인증 오류'));
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={vi.fn()} />);

    await fillAndSubmit('current-pw', 'New-Password#123');

    await waitFor(() => expect(screen.getByText('알 수 없는 인증 오류')).toBeInTheDocument());
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('성공하면 refreshMe 후 onSuccess가 호출된다', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={onSuccess} />);

    await fillAndSubmit('current-pw', 'New-Password#123');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockRefreshMe).toHaveBeenCalledTimes(1);
  });

  it('새 비밀번호와 확인이 다르면 서버 호출 없이 불일치 오류를 보여준다', async () => {
    render(<ChangePasswordForm submitLabel="변경하고 계속하기" onSuccess={vi.fn()} />);
    await fillAndSubmit('current-pw', 'New-Password#123', 'Different-Password#1');

    expect(await screen.findByText('새 비밀번호가 일치하지 않습니다.')).toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});
