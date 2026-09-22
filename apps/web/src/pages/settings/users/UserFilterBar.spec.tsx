import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserFilterBar } from './UserFilterBar';

/**
 * `UserFilterBar` 자동시험 — 2차 코드리뷰 Low 관찰사항(c) 커버. 서버 스키마(`status`)는 단일
 * 값만 허용하므로, 상태 체크박스가 **0개 또는 2개** 선택된 경우 "조용히 전체로 폴백된다"는
 * 규칙을 화면이 안내(`statusFilterFallbackHint`)해야 한다. 정확히 1개 선택 시에는 안내가
 * 사라져야 한다.
 */
describe('UserFilterBar — 상태 필터 폴백 힌트(Medium #3)', () => {
  function renderBar(status: Array<'ACTIVE' | 'DISABLED'>) {
    const onStatusChange = vi.fn();
    render(
      <UserFilterBar
        q=""
        role={[]}
        status={status}
        onQChange={vi.fn()}
        onRoleChange={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );
    return { onStatusChange };
  }

  it('상태 체크박스를 0개 선택하면 힌트가 노출된다', () => {
    renderBar([]);
    expect(screen.getByRole('status')).toHaveTextContent('상태를 하나만 선택하면 그 상태만, 0개나 둘 다 선택하면 전체를 표시합니다.');
  });

  it('정확히 1개 선택하면 힌트가 사라진다', () => {
    renderBar(['ACTIVE']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('2개(전체) 선택하면 다시 힌트가 노출된다', () => {
    renderBar(['ACTIVE', 'DISABLED']);
    expect(screen.getByRole('status')).toHaveTextContent('상태를 하나만 선택하면 그 상태만, 0개나 둘 다 선택하면 전체를 표시합니다.');
  });

  it('체크박스를 클릭하면 onStatusChange가 토글된 배열로 호출된다', async () => {
    const { onStatusChange } = renderBar(['ACTIVE']);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('비활성'));
    expect(onStatusChange).toHaveBeenCalledWith(['ACTIVE', 'DISABLED']);
  });
});
