import { MESSAGES } from '../constants/messages';
import { createMessageList, type MessageListController } from './message-list';
import { createComposer, type ComposerController } from './composer';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([readonly]), [tabindex]:not([tabindex="-1"])';

export interface PanelController {
  root: HTMLElement;
  messages: MessageListController;
  composer: ComposerController;
  status: HTMLElement;
  logo: HTMLImageElement;
  title: HTMLHeadingElement;
  setOpen(open: boolean): void;
  setStatusText(text: string): void;
}

/**
 * `#cb-panel`(FR-W-19 포커스 트랩 — Tab이 패널 밖으로 나가지 않는다). `Esc`는 `onClose`(→ 런처 복귀는
 * 호출부 책임, §5.3). 헤더(로고/타이틀/닫기) + 메시지 로그 + status + 입력창으로 구성한다(§5.1).
 */
export function createPanel(onClose: () => void, onSubmit: (text: string) => void): PanelController {
  const root = document.createElement('section');
  root.id = 'cb-panel';
  root.className = 'cb-panel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'cb-panel-title');
  root.hidden = true;

  const header = document.createElement('header');
  header.className = 'cb-header';

  const logo = document.createElement('img');
  logo.className = 'cb-logo';
  logo.alt = '';
  logo.hidden = true;

  const title = document.createElement('h2');
  title.id = 'cb-panel-title';
  title.className = 'cb-title';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'cb-close';
  closeBtn.type = 'button';
  closeBtn.className = 'cb-close';
  closeBtn.setAttribute('aria-label', MESSAGES.closeLabel);
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', onClose);

  header.append(logo, title, closeBtn);

  const messages = createMessageList();

  const status = document.createElement('div');
  status.id = 'cb-status';
  status.className = 'cb-status';
  status.setAttribute('role', 'status');

  const composer = createComposer(onSubmit);

  root.append(header, messages.root, status, composer.root);

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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
  });

  return {
    root,
    messages,
    composer,
    status,
    logo,
    title,
    setOpen(open) {
      root.hidden = !open;
    },
    setStatusText(text) {
      status.textContent = text;
    },
  };
}
