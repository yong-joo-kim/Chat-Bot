import { Injectable } from '@nestjs/common';
import type { ImportResourceType } from '@chat-bot/shared-types';

export interface ImportStagingEntry<T = unknown> {
  chatbotId: string;
  resourceType: ImportResourceType;
  plan: T;
  expiresAt: Date;
}

/** dry-run 결과 스테이징 추상화(DD-7 ①안, ADR-0007). Redis/DB 구현으로 교체 가능하도록 인터페이스로 둔다. */
export interface ImportStagingStore {
  set(token: string, entry: ImportStagingEntry): void;
  /** 1회용 소비 — 커밋 후(또는 만료 후) 제거한다(AC-6B-10 서버측 보강). */
  take(token: string): ImportStagingEntry | null;
}

const MAX_ENTRIES = 20;

/** 단일 인스턴스 전제 메모리 스테이징(ADR-0007). TTL 10분, LRU 유사 축출(용량 상한 20건). */
@Injectable()
export class InMemoryImportStagingStore implements ImportStagingStore {
  private readonly store = new Map<string, ImportStagingEntry>();

  set(token: string, entry: ImportStagingEntry): void {
    this.evictExpired();
    if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(token, entry);
  }

  take(token: string): ImportStagingEntry | null {
    const entry = this.store.get(token) ?? null;
    this.store.delete(token);
    if (!entry) return null;
    if (entry.expiresAt.getTime() < Date.now()) return null;
    return entry;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt.getTime() < now) this.store.delete(key);
    }
  }
}
