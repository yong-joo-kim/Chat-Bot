import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TopBar } from './TopBar';
import { UnsavedGuardProvider, useUnsavedGuard } from '../context/UnsavedGuardContext';

/**
 * AC-3-8 회귀 검증: "변경 사항이 있는 폼에서 다른 화면으로 이동 시 저장하지 않은 변경 사항 확인이 표시된다."
 * `SettingsTab`이 `setGuard(() => window.confirm(...))`로 등록하는 패턴을 그대로 재현해
 * TopBar의 "챗봇 목록" 링크가 실제로 그 가드를 타는지 검증한다(code-reviewer 지목 항목 (e)).
 */
function GuardRegistrar({ guard }: { guard: (() => boolean) | null }): null {
  const { setGuard } = useUnsavedGuard();
  useEffect(() => {
    setGuard(guard);
    return () => setGuard(null);
  }, [guard, setGuard]);
  return null;
}

function renderTopBar(guard: (() => boolean) | null): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <UnsavedGuardProvider>
        <GuardRegistrar guard={guard} />
        <TopBar />
        <Routes>
          <Route path="/" element={<p>홈 화면</p>} />
          <Route path="/chatbots" element={<p>챗봇 목록 화면</p>} />
        </Routes>
      </UnsavedGuardProvider>
    </MemoryRouter>,
  );
}

describe('TopBar — AC-3-8 저장 안 된 변경사항 가드', () => {
  it('등록된 가드가 없으면 "챗봇 목록" 클릭 시 정상적으로 이동한다', async () => {
    const user = userEvent.setup();
    renderTopBar(null);

    await user.click(screen.getByRole('link', { name: '챗봇 목록' }));

    expect(screen.getByText('챗봇 목록 화면')).toBeInTheDocument();
  });

  it('가드가 false를 반환하면(사용자가 이동을 취소) 이동이 차단되고 현재 화면이 유지된다', async () => {
    const user = userEvent.setup();
    renderTopBar(() => false);

    await user.click(screen.getByRole('link', { name: '챗봇 목록' }));

    expect(screen.getByText('홈 화면')).toBeInTheDocument();
    expect(screen.queryByText('챗봇 목록 화면')).not.toBeInTheDocument();
  });

  it('가드가 true를 반환하면(사용자가 이동을 확정) 정상적으로 이동한다', async () => {
    const user = userEvent.setup();
    renderTopBar(() => true);

    await user.click(screen.getByRole('link', { name: '챗봇 목록' }));

    expect(screen.getByText('챗봇 목록 화면')).toBeInTheDocument();
  });

  it('실제 SettingsTab과 동일하게 window.confirm을 통해 가드를 구현해도 동일하게 동작한다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderTopBar(() => window.confirm('저장하지 않은 변경 사항이 있습니다. 이동하시겠습니까?'));

    await user.click(screen.getByRole('link', { name: '챗봇 목록' }));

    expect(confirmSpy).toHaveBeenCalledWith('저장하지 않은 변경 사항이 있습니다. 이동하시겠습니까?');
    expect(screen.getByText('홈 화면')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('건너뛰기(본문 바로가기) 링크가 첫 요소로 렌더링된다(UIUX §9)', () => {
    renderTopBar(null);
    const skipLink = screen.getByRole('link', { name: '본문 바로가기' });
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });
});
