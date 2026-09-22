import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { makeAdminUser, makeUser } from '../../test/fixtures';
import { UsersPage } from './UsersPage';

expect.extend(toHaveNoViolations);

const mockUsersList = vi.fn();
const mockRolesList = vi.fn();

vi.mock('../../api/users', () => ({
  usersApi: {
    list: (...args: unknown[]) => mockUsersList(...args),
    create: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    resetPassword: vi.fn(),
  },
  rolesApi: { list: (...args: unknown[]) => mockRolesList(...args) },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: makeAdminUser(), can: () => true }),
}));

/**
 * U1 회원 관리 화면 axe 접근성 스캔 — AC-U-11("신규 화면 3종에 axe 스캔 위반 0건"). 신규
 * 화면·컨텍스트 전용 자동화 테스트가 0건이었던 공백을 메운다. `color-contrast`는
 * `ChatbotListPage.a11y.spec.tsx`와 동일한 이유(jsdom 레이아웃 엔진 부재)로 비활성화한다.
 */
describe('UsersPage — axe 접근성 스캔 (AC-U-11)', () => {
  beforeEach(() => {
    mockUsersList.mockReset();
    mockRolesList.mockReset();
    mockRolesList.mockResolvedValue({ items: [{ role: 'ADMIN', label: '시스템 관리자', permissions: [] }] });
  });

  it('회원 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockUsersList.mockResolvedValue({
      items: [makeUser({ id: 'u-1', name: '김편집', email: 'editor@chat-bot.local' })],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <UsersPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('editor@chat-bot.local');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(회원 0명) 화면에도 접근성 위반이 없다', async () => {
    mockUsersList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <UsersPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('조건에 맞는 회원이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
