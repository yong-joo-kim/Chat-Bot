import type { PendingAnswerSource } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';

/**
 * 출처 텍스트 블록(`SourceList`, FR-N2-20~23, NFR-A3). 링크가 아니라 텍스트다 — 외부 경로를
 * 열 수 없으므로 링크처럼 보이면 안 된다. `sources`가 비어 있으면 `null`을 반환해 블록 자체를
 * 렌더하지 않는다(EX-N2-8, `showSources=false` 설정도 호출부에서 이 함수를 부르지 않는 방식으로 반영).
 */
export function renderSourceList(sources: PendingAnswerSource[]): HTMLElement | null {
  if (!sources || sources.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'cb-sources';

  const label = document.createElement('span');
  label.className = 'cb-sources-label';
  label.textContent = MESSAGES.sourcesLabel;
  wrap.appendChild(label);

  const list = document.createElement('ul');
  for (const source of sources.slice(0, 3)) {
    const li = document.createElement('li');
    const parts = [source.fileName];
    if (source.sectionTitle) parts.push(source.sectionTitle);
    if (source.page) parts.push(`${source.page}쪽`);
    li.textContent = parts.join(' · ');
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const caption = document.createElement('p');
  caption.className = 'cb-sources-caption';
  caption.textContent = MESSAGES.sourcesCaption;
  wrap.appendChild(caption);

  return wrap;
}
