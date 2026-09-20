import { isSafeHttpUrl } from '@chat-bot/shared-types/output-view';

/** `LINK` 아웃풋 — `rel="noopener noreferrer"`, 안전하지 않은 URL은 렌더를 생략한다. */
export function renderLink(payload: { label: string; url: string; openInNewTab: boolean }): HTMLElement | null {
  if (!isSafeHttpUrl(payload.url)) return null;
  const a = document.createElement('a');
  a.className = 'cb-link';
  a.href = payload.url;
  a.textContent = payload.label;
  if (payload.openInNewTab) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}
