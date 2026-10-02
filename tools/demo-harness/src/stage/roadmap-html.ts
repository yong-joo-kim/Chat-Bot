// `/roadmap` 로드맵 행 HTML — 데이터(`data/roadmap.ts`)에서만 만든다(문구 단일 원천). 모든 값은 HTML 이스케이프.
import { ROADMAP, ROADMAP_STATUS_LABEL } from '../data/roadmap';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `<ul id="road-list">` 안에 들어갈 `<li>` 들. */
export function buildRoadmapRows(excludeNos: readonly number[] = []): string {
  return ROADMAP.filter((r) => !excludeNos.includes(r.featureNo)).map(
    (r) =>
      `<li><span class="fn">${esc(r.name)}<small>No.${r.featureNo}</small></span><span class="why">${esc(r.why)}</span><span class="chip"><i class="shape" aria-hidden="true"></i>${esc(ROADMAP_STATUS_LABEL[r.status])}</span></li>`,
  ).join('\n        ');
}
