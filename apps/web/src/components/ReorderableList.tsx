import { useEffect, useRef, type ReactNode } from 'react';

export interface ReorderableListProps<T> {
  items: T[];
  getKey: (item: T) => string;
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** 버튼 `aria-label`에 쓸 항목명(예: "1번째 아웃풋(텍스트)"). */
  itemLabel: (item: T, index: number) => string;
  minItems?: number;
  maxItems?: number;
  onAdd?: () => void;
  addLabel?: string;
  addLimitLabel?: string;
  onRemove?: (key: string) => void;
  removeLabel?: string;
}

/**
 * 순서 변경 리스트(ui-spec §2.2-3). 드래그앤드롭 핸들을 두지 않고 위/아래 버튼만 제공한다(UIUX §3).
 * 버튼 클릭 후에도 포커스가 이동한 항목의 같은 버튼에 남도록 명시적으로 focus()를 호출한다(AC-5-8).
 */
export function ReorderableList<T>({
  items,
  getKey,
  onChange,
  renderItem,
  itemLabel,
  minItems = 0,
  maxItems,
  onAdd,
  addLabel,
  addLimitLabel,
  onRemove,
  removeLabel = '삭제',
}: ReorderableListProps<T>): JSX.Element {
  const buttonRefs = useRef<Map<string, { up?: HTMLButtonElement; down?: HTMLButtonElement }>>(new Map());
  const pendingFocusRef = useRef<{ key: string; dir: 'up' | 'down' } | null>(null);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const refs = buttonRefs.current.get(pending.key);
    const target = pending.dir === 'up' ? refs?.up : refs?.down;
    target?.focus();
  }, [items]);

  function move(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    pendingFocusRef.current = { key: getKey(moved), dir: dir === -1 ? 'up' : 'down' };
    onChange(next);
  }

  const atMax = maxItems !== undefined && items.length >= maxItems;

  return (
    <div className="reorderable-list">
      {items.map((item, index) => {
        const key = getKey(item);
        const label = itemLabel(item, index);
        return (
          <div key={key} className="reorderable-item">
            <div className="reorderable-item-content">{renderItem(item, index)}</div>
            <div className="reorderable-item-actions">
              <button
                type="button"
                className="reorderable-btn"
                aria-label={`${label} 위로`}
                disabled={index === 0}
                aria-disabled={index === 0}
                onClick={() => move(index, -1)}
                ref={(el) => {
                  const entry = buttonRefs.current.get(key) ?? {};
                  entry.up = el ?? undefined;
                  buttonRefs.current.set(key, entry);
                }}
              >
                ▲
              </button>
              <button
                type="button"
                className="reorderable-btn"
                aria-label={`${label} 아래로`}
                disabled={index === items.length - 1}
                aria-disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                ref={(el) => {
                  const entry = buttonRefs.current.get(key) ?? {};
                  entry.down = el ?? undefined;
                  buttonRefs.current.set(key, entry);
                }}
              >
                ▼
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="reorderable-btn reorderable-btn--danger"
                  aria-label={`${label} ${removeLabel}`}
                  disabled={items.length <= minItems}
                  onClick={() => onRemove(key)}
                >
                  ⌫
                </button>
              )}
            </div>
          </div>
        );
      })}
      {onAdd && (
        <div className="reorderable-add-row">
          <button type="button" className="btn btn-secondary" onClick={onAdd} disabled={atMax}>
            {addLabel ?? '+ 추가'}
          </button>
          {atMax && addLimitLabel && <span className="field-hint">{addLimitLabel}</span>}
        </div>
      )}
    </div>
  );
}
