/**
 * [신규 No.46] 캐러셀 순수 함수(위치 판정) — DOM 무의존(`ui/renderers/carousel.ts`와 분리, §12.1).
 */

/** 스크롤 위치에 가장 가까운 카드 인덱스를 고른다(카드 폭이 서로 달라도 안전). */
export function nearestCardIndex(scrollLeft: number, cardOffsets: readonly number[]): number {
  if (cardOffsets.length === 0) return 0;
  let closest = 0;
  let closestDist = Math.abs(cardOffsets[0] - scrollLeft);
  for (let i = 1; i < cardOffsets.length; i += 1) {
    const dist = Math.abs(cardOffsets[i] - scrollLeft);
    if (dist < closestDist) {
      closest = i;
      closestDist = dist;
    }
  }
  return closest;
}

/** 카드 인덱스를 `[0, count-1]` 범위로 자른다(빈 캐러셀은 0). */
export function clampCardIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}
