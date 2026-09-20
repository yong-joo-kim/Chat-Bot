import { isSafeHttpUrl } from '@chat-bot/shared-types/output-view';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem } from '@chat-bot/shared-types';
import { renderButtonGroup } from './button';

export interface CardPayload {
  title: string;
  description?: string;
  imageUrl?: string;
  altText?: string;
  buttons?: ButtonItem[];
}

/** `CARD` 아웃풋. 이미지 URL이 `isSafeHttpUrl()` 실패 시 `<img>`를 렌더하지 않는다(EX-W-5). */
export function renderCard(payload: CardPayload, onButtonAction: (action: ButtonActionView) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cb-card';

  if (payload.imageUrl && isSafeHttpUrl(payload.imageUrl)) {
    const img = document.createElement('img');
    img.className = 'cb-card-image';
    img.src = payload.imageUrl;
    img.alt = payload.altText ?? '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    card.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'cb-card-body';
  const title = document.createElement('h3');
  title.className = 'cb-card-title';
  title.textContent = payload.title;
  body.appendChild(title);
  if (payload.description) {
    const desc = document.createElement('p');
    desc.className = 'cb-card-desc';
    desc.textContent = payload.description;
    body.appendChild(desc);
  }
  card.appendChild(body);

  if (payload.buttons && payload.buttons.length > 0) {
    card.appendChild(renderButtonGroup(payload.buttons, onButtonAction));
  }
  return card;
}
