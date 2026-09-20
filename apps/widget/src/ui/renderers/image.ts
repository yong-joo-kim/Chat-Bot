import { isSafeHttpUrl } from '@chat-bot/shared-types/output-view';

/** `IMAGE` 아웃풋 — 깨지면 대체 텍스트로 폴백, 레이아웃이 무너지지 않는다(EX-W-5). */
export function renderImage(payload: { imageUrl: string; altText: string }): HTMLElement {
  if (!isSafeHttpUrl(payload.imageUrl)) {
    const p = document.createElement('p');
    p.className = 'cb-msg-text';
    p.textContent = payload.altText;
    return p;
  }
  const img = document.createElement('img');
  img.className = 'cb-image';
  img.src = payload.imageUrl;
  img.alt = payload.altText;
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    const fallback = document.createElement('p');
    fallback.className = 'cb-msg-text';
    fallback.textContent = payload.altText;
    img.replaceWith(fallback);
  });
  return img;
}
