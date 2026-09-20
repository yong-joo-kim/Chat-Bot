import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import type { DialogueBundle } from '@chat-bot/shared-types';

export interface CachedBundle {
  bundle: DialogueBundle;
  index: DialogueIndex;
  cachedAt: number;
}

/**
 * 챗봇 대화 자산 번들 캐시(DD-22, ADR-0007 `ImportStagingStore` 패턴 재사용).
 * 챗봇 `status`·`Channel.enabled/config`는 여기 담지 않는다 — 긴급 중단(S-10)이
 * 캐시 TTL과 무관하게 즉시 반영되어야 하므로 `PublicAccessService`가 매 요청 직접 조회한다(§8.1).
 */
export interface DialogueBundleCache {
  get(chatbotId: string): CachedBundle | undefined;
  set(chatbotId: string, value: CachedBundle): void;
  invalidate(chatbotId: string): void;
  clear(): void;
}

export const DIALOGUE_BUNDLE_CACHE_MAX_ENTRIES = 50;

export class InMemoryDialogueBundleCache implements DialogueBundleCache {
  private readonly store = new Map<string, CachedBundle>();

  constructor(
    private readonly ttlMs: number = 60_000,
    private readonly maxEntries: number = DIALOGUE_BUNDLE_CACHE_MAX_ENTRIES,
  ) {}

  get(chatbotId: string): CachedBundle | undefined {
    const entry = this.store.get(chatbotId);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(chatbotId);
      return undefined;
    }
    // LRU: 접근한 항목을 맨 뒤로 재삽입한다(Map은 삽입 순서를 보존한다).
    this.store.delete(chatbotId);
    this.store.set(chatbotId, entry);
    return entry;
  }

  set(chatbotId: string, value: CachedBundle): void {
    this.store.delete(chatbotId);
    this.store.set(chatbotId, value);
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  invalidate(chatbotId: string): void {
    this.store.delete(chatbotId);
  }

  clear(): void {
    this.store.clear();
  }
}
