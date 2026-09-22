import { useEffect, useRef, useState } from 'react';

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface MultiSelectDropdownProps<T extends string> {
  label: string;
  options: MultiSelectOption<T>[];
  selected: T[];
  onChange: (selected: T[]) => void;
  allLabel?: string;
}

/**
 * 다중선택 체크박스 드롭다운(security-audit-ui-spec.md §2.3, UIUX §6). 옵션 20개 이내 전제.
 * 방향키로 옵션 탐색, `Esc`로 닫히고 포커스는 트리거 버튼으로 복귀한다(UIUX §3). 선택 0개 = "전체".
 */
export function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  allLabel = '전체',
}: MultiSelectDropdownProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent, index: number): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      itemRefs.current[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itemRefs.current[Math.max(index - 1, 0)]?.focus();
    }
  }

  function toggle(value: T): void {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  }

  const summary = selected.length === 0 ? allLabel : `${selected.length}개 선택`;

  return (
    <div className="multi-select-dropdown" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        className="multi-select-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}: {summary} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="multi-select-list" role="group" aria-label={label}>
          {options.map((opt, index) => (
            <label key={opt.value} className="multi-select-option">
              <input
                type="checkbox"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
