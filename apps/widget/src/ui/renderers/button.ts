import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem } from '@chat-bot/shared-types';
import { resolveButtonAction } from '../../core/button-action';
import { MESSAGES } from '../../constants/messages';

/** 버튼 그룹 — 모두 `<button>` 요소(FR-W-20, `div+role` 금지), 44×44px 이상(FR-W-18). */
export function renderButtonGroup(buttons: ButtonItem[], onButtonAction: (action: ButtonActionView) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'cb-buttons';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', MESSAGES.buttonGroupLabel);
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cb-btn';
    el.textContent = btn.label;
    el.addEventListener('click', () => onButtonAction(resolveButtonAction(btn)));
    group.appendChild(el);
  }
  return group;
}

/** `BUTTON` 아웃풋(선택형 안내 문구 + 버튼 그룹). */
export function renderButtonBlock(
  payload: { text?: string; buttons: ButtonItem[] },
  onButtonAction: (action: ButtonActionView) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  if (payload.text) {
    const p = document.createElement('p');
    p.className = 'cb-msg-text';
    p.textContent = payload.text;
    wrap.appendChild(p);
  }
  wrap.appendChild(renderButtonGroup(payload.buttons, onButtonAction));
  return wrap;
}
