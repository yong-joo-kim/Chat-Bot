import type { ButtonActionView, OutputView } from '@chat-bot/shared-types/output-view';
import { planPauseSchedule } from '../core/pause-schedule';
import { renderOutputView } from './renderers';
import { MESSAGES } from '../constants/messages';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MessageListController {
  root: HTMLElement;
  addUserText(text: string): void;
  addSystemText(text: string): void;
  addErrorText(text: string, onRetry?: () => void): void;
  /** `PAUSE` 아웃풋만큼 지연 후 다음 아웃풋을 렌더한다(FR-W-7). `onTyping`으로 대기 상태를 알린다. */
  addBotOutputs(views: OutputView[], onButtonAction: (action: ButtonActionView) => void, onTyping?: (active: boolean) => void): Promise<void>;
}

/** `#cb-messages` — `role="log" aria-live="polite"`(FR-W-21). 새 메시지마다 스크롤을 끝으로 이동한다. */
export function createMessageList(): MessageListController {
  const root = document.createElement('div');
  root.id = 'cb-messages';
  root.className = 'cb-messages';
  root.setAttribute('role', 'log');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-relevant', 'additions');
  root.tabIndex = 0;

  function scrollToEnd(): void {
    root.scrollTop = root.scrollHeight;
  }

  function wrapMessage(role: 'bot' | 'user' | 'system' | 'error'): HTMLElement {
    const el = document.createElement('div');
    el.className = `cb-msg cb-msg-${role}`;
    return el;
  }

  function bubble(): HTMLElement {
    const b = document.createElement('div');
    b.className = 'cb-bubble';
    return b;
  }

  function addPlainText(role: 'bot' | 'user', text: string): void {
    const el = wrapMessage(role);
    const b = bubble();
    b.appendChild(renderPlainText(text));
    el.appendChild(b);
    root.appendChild(el);
    scrollToEnd();
  }

  function renderPlainText(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'cb-msg-text';
    p.textContent = text;
    return p;
  }

  return {
    root,
    addUserText(text) {
      addPlainText('user', text);
    },
    addSystemText(text) {
      const el = wrapMessage('system');
      el.textContent = text;
      root.appendChild(el);
      scrollToEnd();
    },
    addErrorText(text, onRetry) {
      const el = wrapMessage('error');
      const b = bubble();
      b.setAttribute('role', 'alert');
      b.appendChild(renderPlainText(text));
      if (onRetry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-retry';
        btn.textContent = MESSAGES.retry;
        btn.addEventListener('click', onRetry);
        b.appendChild(btn);
      }
      el.appendChild(b);
      root.appendChild(el);
      scrollToEnd();
    },
    async addBotOutputs(views, onButtonAction, onTyping) {
      const el = wrapMessage('bot');
      const b = bubble();
      el.appendChild(b);
      root.appendChild(el);
      scrollToEnd();

      const delays = planPauseSchedule(views);
      let renderedAny = false;
      for (let i = 0; i < views.length; i += 1) {
        const view = views[i];
        if (view.type === 'PAUSE') {
          const ms = delays[i] ?? 0;
          if (ms > 0) {
            onTyping?.(true);
            await sleep(ms);
            onTyping?.(false);
          }
          continue;
        }
        const node = renderOutputView(view, onButtonAction);
        if (node) {
          b.appendChild(node);
          renderedAny = true;
          scrollToEnd();
        }
      }
      if (!renderedAny) {
        // 응답 아웃풋이 0건이어도 빈 말풍선을 두지 않는다(EX-W-6).
        b.appendChild(renderPlainText(MESSAGES.emptyOutputsFallback));
      }
    },
  };
}
