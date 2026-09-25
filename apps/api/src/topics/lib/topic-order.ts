/** 토픽 정렬 순서 순수 함수(topic-system-설계.md §5.1) — DB·Nest 무의존. */

export function nextSortOrder(existing: readonly { sortOrder: number }[]): number {
  return existing.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1;
}

export interface SwapTarget {
  id: string;
  sortOrder: number;
}

/**
 * `direction`으로 이동할 때 교환할 인접 토픽을 고른다(정렬 순서 오름차순 기준).
 * 이동할 수 없으면(맨 앞/뒤) `null`을 반환한다.
 */
export function findAdjacentForSwap(
  ordered: readonly SwapTarget[],
  targetId: string,
  direction: 'UP' | 'DOWN',
): SwapTarget | null {
  const index = ordered.findIndex((t) => t.id === targetId);
  if (index === -1) return null;
  const adjacentIndex = direction === 'UP' ? index - 1 : index + 1;
  if (adjacentIndex < 0 || adjacentIndex >= ordered.length) return null;
  return ordered[adjacentIndex];
}
