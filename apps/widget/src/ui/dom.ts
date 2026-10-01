/** 음성 UI 3종(말하기·듣기·토글)이 공유하는 DOM 헬퍼 — 번들 크기를 위해 `createElement`+속성 대입 반복을 한 곳에 모은다. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}
