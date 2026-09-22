import type { BannedWordEntry } from './lib/banned-word-filter';

/**
 * 금지어 사전 캐시(DD-44, `DialogueBundleCache`와 동일 패턴). 전역 사전 1벌이므로 키가 없는
 * 단일 슬롯 캐시다. TTL(`BANNED_WORD_CACHE_TTL_MS`, 기본 60초) + 쓰기 시 즉시 무효화(AC-12D-8).
 */
export interface BannedWordCache {
  get(): BannedWordEntry[] | undefined;
  set(entries: BannedWordEntry[]): void;
  invalidate(): void;
}

export class InMemoryBannedWordCache implements BannedWordCache {
  private entries: BannedWordEntry[] | undefined;
  private cachedAt = 0;

  constructor(private readonly ttlMs: number = 60_000) {}

  get(): BannedWordEntry[] | undefined {
    if (this.entries === undefined) return undefined;
    if (Date.now() - this.cachedAt > this.ttlMs) {
      this.entries = undefined;
      return undefined;
    }
    return this.entries;
  }

  set(entries: BannedWordEntry[]): void {
    this.entries = entries;
    this.cachedAt = Date.now();
  }

  invalidate(): void {
    this.entries = undefined;
  }
}
