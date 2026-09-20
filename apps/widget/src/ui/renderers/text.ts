/** `TEXT` 아웃풋 — `textContent`로만 삽입한다(FR-W-11, innerHTML 0건). */
export function renderText(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'cb-msg-text';
  p.textContent = text;
  return p;
}
