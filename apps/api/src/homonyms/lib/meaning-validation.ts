import type { HomonymMeaning } from '@chat-bot/shared-types';

/** 의미가 참조하는 intentId 중 (같은 챗봇에) 존재하지 않는 값 목록을 반환한다(FR-7-5). */
export function findInvalidIntentIds(meanings: HomonymMeaning[], validIntentIds: Set<string>): string[] {
  const invalid = new Set<string>();
  for (const meaning of meanings) {
    if (meaning.intentId && !validIntentIds.has(meaning.intentId)) invalid.add(meaning.intentId);
  }
  return [...invalid];
}
