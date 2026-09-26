import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem } from '@chat-bot/shared-types';
import { resolveButtonAction } from '../../core/button-action';
import { MESSAGES } from '../../constants/messages';

/**
 * RM-10 — 바로연결 칩 묶음(§3.10·§12.2). 모두 `<button>`(44px 이상) · `role="group"` ·
 * LINK는 방어적으로 걸러낸다(서버가 배치를 검증하지만 클라이언트도 방어, R-12).
 */
export function renderQuickReplies(buttons: ButtonItem[], onButtonAction: (action: ButtonActionView) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'cb-quick-replies';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', MESSAGES.quickReplies.groupLabel);
  for (const btn of buttons) {
    if (btn.action === 'LINK') continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cb-quick-reply';
    el.textContent = btn.label;
    el.addEventListener('click', () => onButtonAction(resolveButtonAction(btn)));
    group.appendChild(el);
  }
  return group;
}
