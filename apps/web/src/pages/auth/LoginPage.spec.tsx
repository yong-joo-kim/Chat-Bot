import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ApiError } from '../../api/client';

const mockLogin = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: (...args: unknown[]) => mockLogin(...args) }),
}));

function renderLoginPage(initialEntries: string[] = ['/login']): void {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>홈 화면</div>} />
        <Route path="/chatbots/:id" element={<div>딥링크 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * L1 로그인 화면 자동시험 — AC-U-2(키보드만으로 로그인 완료)를 커버한다. 신규 화면 자동화
 * 테스트가 0건이었던 공백 중 하나다. 마우스 이벤트(click)를 전혀 사용하지 않고 문자입력/Tab/Enter만으로
 * 이메일 입력 → 비밀번호 입력 → 제출까지 전 과정을 완료할 수 있는지 검증한다.
 *
 * 이메일 입력란은 `autoFocus`라 렌더 직후 이미 포커스를 갖는다(DOM 순서: 이메일 입력 → 비밀번호
 * 표시/숨김 토글 버튼 → 비밀번호 입력 → 제출 버튼). 따라서 첫 Tab은 "토글 버튼"으로 이동한다.
 */
describe('LoginPage — AC-U-2 키보드만으로 로그인 완료', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('마우스 클릭 없이 이메일/비밀번호를 입력하고 Enter로 제출하면 로그인이 완료된다', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage();

    // 0) autoFocus로 이메일 입력란이 이미 포커스를 갖고 있다(마우스 클릭 없이 바로 입력 가능).
    expect(screen.getByLabelText('이메일 *')).toHaveFocus();
    await user.keyboard('keyboard-user@chat-bot.local');

    // 1) Tab → 비밀번호 표시/숨김 토글 버튼(DOM 순서상 비밀번호 입력란보다 앞에 있다).
    await user.tab();
    expect(screen.getByRole('button', { name: '표시' })).toHaveFocus();

    // 2) Tab → 비밀번호 입력란.
    await user.tab();
    expect(screen.getByLabelText('비밀번호 *')).toHaveFocus();
    await user.keyboard('Keyboard-Password#1');

    // 3) Tab → 제출 버튼. Enter로 제출한다(마우스 클릭 없음).
    await user.tab();
    expect(screen.getByRole('button', { name: '로그인' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('keyboard-user@chat-bot.local', 'Keyboard-Password#1'));
    await waitFor(() => expect(screen.getByText('홈 화면')).toBeInTheDocument());
  });

  it('returnTo 쿼리가 있으면 로그인 성공 후 원래 경로로 복귀한다(FR-U-2)', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage(['/login?returnTo=%2Fchatbots%2Fid-1']);

    await user.keyboard('a@b.com');
    await user.tab();
    await user.tab();
    await user.keyboard('pw');
    await user.tab();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('딥링크 화면')).toBeInTheDocument());
  });

  it('로그인 실패(401 INVALID_CREDENTIALS) 시 계정 열거 방지 고정 문구를 배너로 보여주고 화면 전환은 없다', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, '서버 메시지는 쓰지 않는다', 'INVALID_CREDENTIALS'));
    const user = userEvent.setup();
    renderLoginPage();

    await user.keyboard('a@b.com');
    await user.tab();
    await user.tab();
    await user.keyboard('wrong-pw');
    await user.tab();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않습니다.'));
    expect(screen.queryByText('홈 화면')).not.toBeInTheDocument();
  });
});
