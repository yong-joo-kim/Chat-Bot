import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequirePermission } from './RequirePermission';
import { makeViewerUser } from '../../test/fixtures';

const mockUseAuth = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <p data-testid="current-path">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/settings/users"
          element={
            <RequirePermission permission="user:read" menuName="회원 관리">
              <div>회원 관리 화면</div>
            </RequirePermission>
          }
        />
        <Route path="/" element={<div>홈</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * `RequirePermission`(L4 게이트) 자동시험 — AC-U-6("이 페이지에 접근할 권한이 없습니다" 안내 +
 * 주소창은 시도한 경로를 유지)을 커버한다. 빈 화면·무한 로딩이 아니라 명시적 403 안내가
 * 나오는지, 그리고 **주소가 실제로 바뀌지 않는지**(리다이렉트가 아니라 같은 라우트에서 콘텐츠만
 * 대체 렌더되는지)를 함께 검증한다.
 */
describe('RequirePermission — AC-U-6 403 접근 거부', () => {
  it('권한이 없으면 안내 화면을 보여주고 주소창 경로는 시도한 경로 그대로 유지된다', () => {
    mockUseAuth.mockReturnValue({ user: makeViewerUser(), can: () => false });
    renderAt('/settings/users?tab=1');

    expect(screen.getByRole('heading', { name: '이 페이지에 접근할 권한이 없습니다' })).toBeInTheDocument();
    expect(screen.queryByText('회원 관리 화면')).not.toBeInTheDocument();
    // 리다이렉트가 일어났다면 경로가 "/"로 바뀌었을 것이다 — 그대로 남아있어야 한다.
    expect(screen.getByTestId('current-path').textContent).toBe('/settings/users?tab=1');
  });

  it('홈으로 가는 링크가 제공된다(빈 화면·무한 로딩 아님)', () => {
    mockUseAuth.mockReturnValue({ user: makeViewerUser(), can: () => false });
    renderAt('/settings/users');

    expect(screen.getByRole('link', { name: '홈으로 돌아가기' })).toHaveAttribute('href', '/');
  });

  it('권한이 있으면 원래 콘텐츠가 렌더된다', () => {
    mockUseAuth.mockReturnValue({ user: makeViewerUser({ role: 'ADMIN' }), can: () => true });
    renderAt('/settings/users');

    expect(screen.getByText('회원 관리 화면')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '이 페이지에 접근할 권한이 없습니다' })).not.toBeInTheDocument();
  });
});
