import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupOption } from './ScopeSelector';
import { ScopeSelector } from './ScopeSelector';

function makeGroups(): GroupOption[] {
  return [
    { id: 'g-active-1', name: '세무 서비스', createdAt: new Date('2026-01-05T00:00:00.000Z'), archivedAt: null, chatbotCount: 3 },
    { id: 'g-active-2', name: '사업자 서비스', createdAt: new Date('2026-02-01T00:00:00.000Z'), archivedAt: null, chatbotCount: 2 },
    { id: 'g-archived-1', name: '2024 이벤트', createdAt: new Date('2025-01-01T00:00:00.000Z'), archivedAt: new Date('2025-12-01T00:00:00.000Z'), chatbotCount: 0 },
  ];
}

describe('ScopeSelector', () => {
  it('기본값으로 "전체"가 선택되어 있고 그룹 콤보박스는 보이지 않는다', () => {
    render(
      <ScopeSelector
        scope="ALL"
        groups={makeGroups()}
        groupsLoading={false}
        groupsError={false}
        truncated={false}
        onRetryGroups={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: '전체' })).toBeChecked();
    expect(screen.queryByLabelText('그룹 선택')).not.toBeInTheDocument();
  });

  it('"그룹" 라디오를 선택하면 onChange("GROUP", 기존 groupId)를 호출한다', () => {
    const onChange = vi.fn();
    render(
      <ScopeSelector
        scope="ALL"
        groups={makeGroups()}
        groupsLoading={false}
        groupsError={false}
        truncated={false}
        onRetryGroups={vi.fn()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '그룹' }));
    expect(onChange).toHaveBeenCalledWith('GROUP', undefined);
  });

  it('scope=GROUP이면 활성 그룹(생성일 오름차순) 다음에 "보관된 그룹" optgroup을 보여준다', () => {
    render(
      <ScopeSelector
        scope="GROUP"
        groupId="g-active-1"
        groups={makeGroups()}
        groupsLoading={false}
        groupsError={false}
        truncated={false}
        onRetryGroups={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText('그룹 선택') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['그룹을 선택하세요', '세무 서비스', '사업자 서비스', '2024 이벤트']);
    const optgroup = select.querySelector('optgroup');
    expect(optgroup).toHaveAttribute('label', '보관된 그룹');
  });

  it('그룹 옵션을 선택하면 onChange("GROUP", id)를 호출한다', () => {
    const onChange = vi.fn();
    render(
      <ScopeSelector
        scope="GROUP"
        groupId="g-active-1"
        groups={makeGroups()}
        groupsLoading={false}
        groupsError={false}
        truncated={false}
        onRetryGroups={vi.fn()}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('그룹 선택'), { target: { value: 'g-active-2' } });
    expect(onChange).toHaveBeenCalledWith('GROUP', 'g-active-2');
  });

  it('이름이 같은 그룹이 있으면 생성일을 병기한다(EX-I-11)', () => {
    const groups: GroupOption[] = [
      { id: 'a', name: '중복그룹', createdAt: new Date('2026-01-01T00:00:00.000Z'), archivedAt: null, chatbotCount: 1 },
      { id: 'b', name: '중복그룹', createdAt: new Date('2026-02-01T00:00:00.000Z'), archivedAt: null, chatbotCount: 1 },
    ];
    render(
      <ScopeSelector scope="GROUP" groups={groups} groupsLoading={false} groupsError={false} truncated={false} onRetryGroups={vi.fn()} onChange={vi.fn()} />,
    );
    expect(screen.getByText('중복그룹 (2026-01-01 생성)')).toBeInTheDocument();
    expect(screen.getByText('중복그룹 (2026-02-01 생성)')).toBeInTheDocument();
  });

  it('truncated=true면 안내 문구를 보여준다', () => {
    render(
      <ScopeSelector scope="GROUP" groups={makeGroups()} groupsLoading={false} groupsError={false} truncated onRetryGroups={vi.fn()} onChange={vi.fn()} />,
    );
    expect(screen.getByText('그룹이 많아 일부만 표시됩니다.')).toBeInTheDocument();
  });

  it('그룹 목록 조회 실패 시 오류 상태와 다시 시도 버튼을 보여준다', () => {
    const onRetryGroups = vi.fn();
    render(
      <ScopeSelector scope="GROUP" groups={[]} groupsLoading={false} groupsError truncated={false} onRetryGroups={onRetryGroups} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetryGroups).toHaveBeenCalledTimes(1);
  });
});
