import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ReorderableList } from './ReorderableList';

interface Row {
  key: string;
  label: string;
}

function ControlledList({ initial, onChangeSpy }: { initial: Row[]; onChangeSpy: (items: Row[]) => void }): JSX.Element {
  const [items, setItems] = useState<Row[]>(initial);
  return (
    <ReorderableList
      items={items}
      getKey={(r) => r.key}
      onChange={(next) => {
        setItems(next);
        onChangeSpy(next);
      }}
      itemLabel={(r, i) => `${i + 1}번째 아웃풋(${r.label})`}
      renderItem={(r) => <span>{r.label}</span>}
    />
  );
}

const THREE_ROWS: Row[] = [
  { key: 'a', label: '텍스트' },
  { key: 'b', label: '카드' },
  { key: 'c', label: '버튼' },
];

/**
 * UIUX §3(드래그앤드롭 금지, 위/아래 버튼만) + AC-5-8(순서 변경 후 포커스가 이동한 항목의
 * 같은 버튼에 유지) 회귀 시험. 노드 아웃풋/버튼/컨텍스트 슬롯 등 여러 화면이 공유하는 컴포넌트다.
 */
describe('ReorderableList — 순서변경 키보드 조작(UIUX §3, AC-5-8)', () => {
  it('첫 항목은 "위로" 버튼이 비활성화되고, 마지막 항목은 "아래로" 버튼이 비활성화된다', () => {
    render(<ControlledList initial={THREE_ROWS} onChangeSpy={vi.fn()} />);

    expect(screen.getByRole('button', { name: '1번째 아웃풋(텍스트) 위로' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '3번째 아웃풋(버튼) 아래로' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1번째 아웃풋(텍스트) 아래로' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '3번째 아웃풋(버튼) 위로' })).toBeEnabled();
  });

  it('Tab으로 "아래로" 버튼에 도달해 Enter/Space로 실행하면 순서가 바뀌고 포커스가 이동한 항목의 같은 버튼에 남는다(AC-5-8)', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<ControlledList initial={THREE_ROWS} onChangeSpy={onChangeSpy} />);

    const firstDown = screen.getByRole('button', { name: '1번째 아웃풋(텍스트) 아래로' });
    firstDown.focus();
    expect(firstDown).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onChangeSpy).toHaveBeenCalledWith([
      { key: 'b', label: '카드' },
      { key: 'a', label: '텍스트' },
      { key: 'c', label: '버튼' },
    ]);

    // 이동한 항목('텍스트')은 이제 2번째다 — 그 항목의 "아래로" 버튼에 포커스가 유지되어야 한다.
    const movedItemDownButton = await screen.findByRole('button', { name: '2번째 아웃풋(텍스트) 아래로' });
    expect(movedItemDownButton).toHaveFocus();
  });

  it('마우스 클릭으로 "위로"를 실행해도 동일하게 순서가 바뀐다(클릭/키보드 동일 동작, UIUX §3)', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<ControlledList initial={THREE_ROWS} onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('button', { name: '3번째 아웃풋(버튼) 위로' }));

    expect(onChangeSpy).toHaveBeenCalledWith([
      { key: 'a', label: '텍스트' },
      { key: 'c', label: '버튼' },
      { key: 'b', label: '카드' },
    ]);
  });

  it('드래그 핸들(draggable 속성)이 존재하지 않는다 — 위/아래 버튼이 유일한 순서변경 수단이다(UIUX §3)', () => {
    render(<ControlledList initial={THREE_ROWS} onChangeSpy={vi.fn()} />);
    const draggableEls = document.querySelectorAll('[draggable="true"]');
    expect(draggableEls.length).toBe(0);
  });

  it('onAdd/onRemove/maxItems가 주어지면 추가·삭제 버튼과 상한 안내가 표시된다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <ReorderableList
        items={THREE_ROWS}
        getKey={(r) => r.key}
        onChange={vi.fn()}
        itemLabel={(r, i) => `${i + 1}번째 아웃풋(${r.label})`}
        renderItem={(r) => <span>{r.label}</span>}
        onAdd={onAdd}
        addLabel="+ 아웃풋 추가"
        maxItems={3}
        addLimitLabel="최대 3개까지 추가할 수 있습니다."
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole('button', { name: '+ 아웃풋 추가' })).toBeDisabled();
    expect(screen.getByText('최대 3개까지 추가할 수 있습니다.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1번째 아웃풋(텍스트) 삭제' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });
});
