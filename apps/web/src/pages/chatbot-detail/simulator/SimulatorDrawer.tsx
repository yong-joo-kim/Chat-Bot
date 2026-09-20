import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MESSAGES } from '../../../constants/messages';
import { SimulatorPanel, type SimulatorPanelProps } from './SimulatorPanel';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SimulatorDrawerProps extends Omit<SimulatorPanelProps, 'mode'> {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 드로어 셸(SIM1-D, FR-10-17/23) — 포커스 트랩 + `Esc` 닫기. **`UnsavedGuardContext`를 등록하지
 * 않는다**(라우트 이동이 아니므로, AC-10-17). 배경 편집 폼을 가리는 전체화면 오버레이를 두지 않고
 * 우측에 고정된 패널만 렌더한다(ui-spec §4.2).
 */
export function SimulatorDrawer({ isOpen, onClose, ...panelProps }: SimulatorDrawerProps): JSX.Element | null {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const input =
      drawer?.querySelector<HTMLElement>('#sim-composer-input') ?? drawer?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    input?.focus();

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && drawer) {
        const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null,
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previousFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="simulator-drawer" role="dialog" aria-modal="false" aria-label={MESSAGES.simulator.drawer.title} ref={drawerRef}>
      <div className="simulator-drawer-header">
        <h2>{MESSAGES.simulator.drawer.title}</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label={MESSAGES.simulator.drawer.close}>
          ✕
        </button>
      </div>
      <div className="simulator-drawer-body">
        <SimulatorPanel {...panelProps} mode="drawer" />
      </div>
    </div>,
    document.body,
  );
}
