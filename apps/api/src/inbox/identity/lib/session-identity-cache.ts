/**
 * [신규 No.42] 세션 식별 캐시 · 실패 지문 캐시(§6.5) — 인스턴스 로컬 LRU(Map 삽입 순서 활용).
 * TTL 경과 항목은 조회 시 제거한다. 용량 초과 시 가장 오래된 항목부터 제거한다.
 */
export class InboxLruCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now: number = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    // LRU 갱신 — 재삽입해 삽입 순서를 최신으로.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, now: number = Date.now()): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
