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
    // 카드 버튼은 되묻기(FR-N1-12)가 절대 쓰지 않는 경로다(엔진은 되묻기를 항상 최상위 BUTTON
    // 아웃풋으로만 반환한다, resolver.ts). 세로 스택 판정에서 구조적으로 제외한다.
    card.appendChild(renderButtonGroup(payload.buttons, onButtonAction, { allowStackedLayout: false }));
  }
  return card;
}
