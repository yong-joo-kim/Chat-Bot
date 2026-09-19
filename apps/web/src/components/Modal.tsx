import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 파괴적 액션 진행 중 등 Esc로 닫으면 안 되는 경우 false로 지정한다. */
  closeOnEsc?: boolean;
  /** 모달이 열릴 때 포커스를 옮길 요소의 셀렉터(기본: 첫 상호작용 요소). */
  initialFocusSelector?: string;
}

/**
 * 공통 모달(ui-spec §2.2). 열릴 때 포커스 이동, 닫히면 트리거로 복귀,
 * `Esc` 닫기 + 포커스 트랩(Tab이 모달 밖으로 나가지 않음)을 보장한다(UIUX §3, AC-5-5).
 */
export function Modal({ isOpen, title, onClose, children, closeOnEsc = true, initialFocusSelector }: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusTarget =
      (initialFocusSelector && dialog?.querySelector<HTMLElement>(initialFocusSelector)) ||
      dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    focusTarget?.focus();

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (!closeOnEsc) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialog) {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
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
  }, [isOpen, closeOnEsc, initialFocusSelector, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

/** 파괴적 액션 확인 모달. 기본 포커스는 "취소"에 둔다(오조작 방지, ui-spec §2.2). */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps): JSX.Element | null {
  return (
    <Modal isOpen={isOpen} title={title} onClose={onCancel} initialFocusSelector='[data-autofocus="cancel"]'>
      <p className="modal-description">{description}</p>
      {children}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} data-autofocus="cancel">
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
