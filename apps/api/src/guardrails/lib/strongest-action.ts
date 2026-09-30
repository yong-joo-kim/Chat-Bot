import type { GuardrailAction } from '@chat-bot/shared-types';
import type { RuleHit } from './types';

const PRIORITY: Record<GuardrailAction, number> = { REPLACE: 3, NO_RAG: 2, MONITOR: 1 };

interface SortKey {
  sortOrder: number;
  createdAtMs: number;
  ruleId: string;
}

/** 적중 규칙 정렬: `sortOrder` → `createdAt` → `id`(동률 규칙, FR-AG1-4). */
export function compareHits(a: SortKey, b: SortKey): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

/**
 * 가장 강한 동작(REPLACE > NO_RAG > MONITOR)과 결정 규칙(그 동작을 가진 규칙 중 정렬 첫 번째)을 고른다.
 * `hits`는 이미 `compareHits` 순으로 정렬돼 있어야 한다. 적중이 없으면 `null`.
 */
export function pickStrongest(hits: readonly RuleHit[]): { action: GuardrailAction; decisive: RuleHit } | null {
  let best: RuleHit | null = null;
  for (const hit of hits) {
    if (best === null || PRIORITY[hit.action] > PRIORITY[best.action]) best = hit;
  }
  return best ? { action: best.action, decisive: best } : null;
}
