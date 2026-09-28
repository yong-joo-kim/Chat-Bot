/**
 * [신규 No.43 — pass 6 · RG-20⑦] 크기 상한이 있는 맵 쓰기(순수). 인스턴스 메모리 맵(재시도한 문서 · 호스트별 연속 429·503 · 중단 호스트 · robots 캐시)은 다른 인스턴스가 끝낸
 * 실행의 항목이 남아 영구히 자라지 않도록 가장 오래된 항목부터 버린다 — 잃어도 1회 더 재시도하거나 robots를 다시 읽을 뿐이라 안전하다.
 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key); // 다시 넣으면 "가장 최근"이 된다.
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
