import { useEffect, useRef, useState } from 'react';

export interface KebabMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * 행/트리 항목의 케밥(⋮) 메뉴(ui-spec §3.1). Tab/Enter로 접근 가능하고,
 * `Esc`로 닫히며 포커스가 트리거 버튼으로 복귀한다(UIUX §3).
 */
export function KebabMenu({ label, items }: { label: string; items: KebabMenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="kebab-menu" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        className="kebab-menu-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className="kebab-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="kebab-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
