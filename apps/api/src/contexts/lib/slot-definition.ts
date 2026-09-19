import type { ContextSlot } from '@chat-bot/shared-types';

/** `type=KEYWORD` 슬롯이 참조하는 키워드 ID 중 (같은 챗봇에) 존재하지 않는 값 목록(FR-8-5). */
export function findInvalidKeywordIds(slots: ContextSlot[], validKeywordIds: Set<string>): string[] {
  const invalid = new Set<string>();
  for (const slot of slots) {
    if (slot.type === 'KEYWORD' && slot.keywordId && !validKeywordIds.has(slot.keywordId)) {
      invalid.add(slot.keywordId);
    }
  }
  return [...invalid];
}
