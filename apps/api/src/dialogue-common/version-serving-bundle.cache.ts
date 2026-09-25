import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import type { DialogueBundle } from '@chat-bot/shared-types';

export interface CachedServingBundle {
  bundle: DialogueBundle;
  index: DialogueIndex;
  cachedAt: number;
}

/**
 * [신규 No.40] §7.3 L2 합성 캐시 — 키 `${chatbotId}:${versionId}:${topicMode}`. TTL 60초(`getCached`와
 * 같음) + LRU. **무효화 지점은 `DialogueBundleService.invalidate(chatbotId)` 1곳을 공유한다**(토픽
 * 토글·설문 편집은 이미 그 지점을 호출한다) — `dialogue-common`에 두는 이유는 이 무효화 지점 공유
 * 때문이다(선택 주입, `unfilteredCache` 선례와 동일한 패턴). `environment/serving`이 DI로 주입받는다.
 */
export interface VersionServingBundleCache {
  get(key: string): CachedServingBundle | undefined;
  set(key: string, value: CachedServingBundle): void;
  /** 특정 챗봇에 속한 항목을 전부 지운다(키 접두사 `${chatbotId}:` 매칭). */
  invalidateChatbot(chatbotId: string): void;
  clear(): void;
}

export const VERSION_SERVING_BUNDLE_CACHE_MAX_ENTRIES = 200;

export class InMemoryVersionServingBundleCache implements VersionServingBundleCache {
  private readonly store = new Map<string, CachedServingBundle>();

  constructor(
    private readonly ttlMs: number = 60_000,
    private readonly maxEntries: number = VERSION_SERVING_BUNDLE_CACHE_MAX_ENTRIES,
  ) {}

  get(key: string): CachedServingBundle | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, value: CachedServingBundle): void {
    this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  invalidateChatbot(chatbotId: string): void {
    const prefix = `${chatbotId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
