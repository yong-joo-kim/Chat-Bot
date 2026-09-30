import { useEffect, useId, useRef, type ReactNode } from 'react';
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
  /** 다이얼로그 설명(본문 요지)을 가리키는 요소 id. 지정 시 `aria-describedby`로 연결한다. */
  describedBy?: string;
}

/**
 * 공통 모달(ui-spec §2.2). 열릴 때 포커스 이동, 닫히면 트리거로 복귀,
 * `Esc` 닫기 + 포커스 트랩(Tab이 모달 밖으로 나가지 않음)을 보장한다(UIUX §3, AC-5-5).
 */
export function Modal({ isOpen, title, onClose, children, closeOnEsc = true, initialFocusSelector, describedBy }: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;
  // [신규 No.36] 호출부가 매 렌더마다 새 `onClose`(인라인 화살표)를 넘겨도 아래 이펙트가 다시 돌지 않게 최신 값만 ref로 든다.
  // 이펙트가 렌더마다 재실행되면 열려 있는 동안 타이핑할 때마다 포커스가 첫 요소(취소·닫기)로 되돌아가 입력이 끊긴다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscRef = useRef(closeOnEsc);
  closeOnEscRef.current = closeOnEsc;
  const initialFocusSelectorRef = useRef(initialFocusSelector);
  initialFocusSelectorRef.current = initialFocusSelector;
  // 초기 포커스 대상(`initialFocusSelector`)에 이미 포커스를 줬는지 — 내용이 비동기로 나중에 그려지는 대화상자(미리보기 조회 뒤 취소 버튼이 생김)는
  // 대상이 처음 나타난 시점에 한 번만 옮긴다(아래 두 번째 이펙트).
  const initialFocusDoneRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const selector = initialFocusSelectorRef.current;
    const focusTarget = (selector && dialog?.querySelector<HTMLElement>(selector)) || dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    focusTarget?.focus();
    initialFocusDoneRef.current = Boolean(selector && dialog?.querySelector(selector));

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (!closeOnEscRef.current) return;
        e.stopPropagation();
        onCloseRef.current();
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
  }, [isOpen]);

  // 열려 있는 동안 매 렌더 뒤: 초기 포커스 대상이 이번에 처음 생겼거나(비동기 내용) 포커스가 대화상자 밖으로 사라졌을 때(대상 요소가 다시 그려짐)만
  // 대상으로 옮긴다. 그 밖의 렌더(타이핑 등)에서는 포커스를 건드리지 않는다.
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const selector = initialFocusSelectorRef.current;
    if (!dialog || !selector) return;
    const target = dialog.querySelector<HTMLElement>(selector);
    if (!target) return;
    const focusLost = !dialog.contains(document.activeElement);
    if (!initialFocusDoneRef.current || focusLost) {
      initialFocusDoneRef.current = true;
      if (document.activeElement !== target) target.focus();
    }
  });

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        ref={dialogRef}
      >
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
  const descriptionId = useId();
  const hasDescription = description !== null && description !== undefined && description !== false && description !== '';
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      initialFocusSelector='[data-autofocus="cancel"]'
      describedBy={hasDescription ? descriptionId : undefined}
    >
      <p className="modal-description" id={hasDescription ? descriptionId : undefined}>
        {description}
      </p>
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
