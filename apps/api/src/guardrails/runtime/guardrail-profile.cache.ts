import type { CompiledProfile } from '../lib/compile-profile';
import type { GuardrailPiiKind } from '@chat-bot/shared-types';

/** 챗봇별 출구 개인정보 가림 설정(행 없음 = 기본값). */
export interface ExitSetting {
  kinds: GuardrailPiiKind[];
  preserveDates: boolean;
  isDefault: boolean;
}

interface Slot<T> {
  value: T;
  loadedAt: number;
}

/** 적재 실패 뒤 직전 값을 유지하면서 다시 시도하기까지의 지연(설계서 §4.4 ①). */
export const RETRY_AFTER_FAILURE_MS = 5_000;

/**
 * 가드레일 3층 캐시(설계서 §4.4) — ① 전역 색인(단일 슬롯: 켜진 규칙이 있는 챗봇 id 집합) ② 챗봇별 규칙
 * 프로필 ③ 챗봇별 출구 설정. TTL + 즉시 무효화 + stale-on-error. 순수 클래스(DB·Nest 무의존 — 시계 주입).
 */
export class GuardrailProfileCache {
  private index: Slot<Set<string>> | null = null;
  private readonly profiles = new Map<string, Slot<CompiledProfile>>();
  private readonly settings = new Map<string, Slot<ExitSetting>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 5000,
  ) {}

  private isFresh(slot: Slot<unknown>): boolean {
    return this.now() - slot.loadedAt < this.ttlMs;
  }

  /** 반환: 값이 있으면 `{ value, fresh }`, 한 번도 적재하지 못했으면 `null`. */
  getIndex(): { value: Set<string>; fresh: boolean } | null {
    return this.index ? { value: this.index.value, fresh: this.isFresh(this.index) } : null;
  }

  setIndex(value: Set<string>): void {
    this.index = { value, loadedAt: this.now() };
  }

  /** 적재 실패 — 직전 값을 유지하고 잠시 뒤 다시 시도하도록 적재 시각을 당겨 둔다. */
  deferIndexRetry(): void {
    if (this.index) this.index.loadedAt = this.now() - Math.max(0, this.ttlMs - RETRY_AFTER_FAILURE_MS);
  }

  getProfile(chatbotId: string): { value: CompiledProfile; fresh: boolean } | null {
    const slot = this.profiles.get(chatbotId);
    return slot ? { value: slot.value, fresh: this.isFresh(slot) } : null;
  }

  setProfile(chatbotId: string, value: CompiledProfile): void {
    this.put(this.profiles, chatbotId, value);
  }

  deferProfileRetry(chatbotId: string): void {
    const slot = this.profiles.get(chatbotId);
    if (slot) slot.loadedAt = this.now() - Math.max(0, this.ttlMs - RETRY_AFTER_FAILURE_MS);
  }

  getSetting(chatbotId: string): { value: ExitSetting; fresh: boolean } | null {
    const slot = this.settings.get(chatbotId);
    return slot ? { value: slot.value, fresh: this.isFresh(slot) } : null;
  }

  setSetting(chatbotId: string, value: ExitSetting): void {
    this.put(this.settings, chatbotId, value);
  }

  deferSettingRetry(chatbotId: string): void {
    const slot = this.settings.get(chatbotId);
    if (slot) slot.loadedAt = this.now() - Math.max(0, this.ttlMs - RETRY_AFTER_FAILURE_MS);
  }

  /** 규칙 쓰기 — 전역 색인과 그 챗봇 프로필을 즉시 무효화한다. */
  invalidateRules(chatbotId: string): void {
    this.index = null;
    this.profiles.delete(chatbotId);
  }

  /** 출구 설정 저장. */
  invalidateSetting(chatbotId: string): void {
    this.settings.delete(chatbotId);
  }

  clear(): void {
    this.index = null;
    this.profiles.clear();
    this.settings.clear();
  }

  /** 시험용 크기 확인. */
  size(): { profiles: number; settings: number } {
    return { profiles: this.profiles.size, settings: this.settings.size };
  }

  /** 상한 초과 시 가장 오래 적재된 항목부터 제거(FIFO — Map 삽입 순서). */
  private put<T>(map: Map<string, Slot<T>>, key: string, value: T): void {
    map.delete(key);
    map.set(key, { value, loadedAt: this.now() });
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}
