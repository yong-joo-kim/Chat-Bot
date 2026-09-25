import type { DialogueBundle, EmbeddingOwnerType } from '@chat-bot/shared-types';
import { textHashOf } from './text-hash';

export interface SemanticSlot {
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  slotIndex: number;
  text: string;
  textHash: string;
}

/**
 * [신규 No.40] `bundle`(버전 코어)에서 의미 색인 대상 슬롯을 뽑는다 — `IndexerService.reindexChatbot()`
 * 의 대상 규칙과 **동등**해야 한다(비활성 FAQ도 포함, 토픽 필터 적용 전 원본). 순수 함수 · DB 무의존.
 */
export function deriveSemanticSlots(bundle: Pick<DialogueBundle, 'faqs' | 'intents'>): SemanticSlot[] {
  const slots: SemanticSlot[] = [];
  for (const faq of bundle.faqs) {
    slots.push({ ownerType: 'FAQ_QUESTION', ownerId: faq.id, slotIndex: 0, text: faq.question, textHash: textHashOf(faq.question) });
    faq.altQuestions.forEach((alt, i) => {
      slots.push({ ownerType: 'FAQ_ALT', ownerId: faq.id, slotIndex: i, text: alt, textHash: textHashOf(alt) });
    });
  }
  for (const intent of bundle.intents) {
    slots.push({ ownerType: 'INTENT_NAME', ownerId: intent.id, slotIndex: 0, text: intent.name, textHash: textHashOf(intent.name) });
    intent.examples.forEach((example, i) => {
      slots.push({ ownerType: 'INTENT_EXAMPLE', ownerId: intent.id, slotIndex: i, text: example, textHash: textHashOf(example) });
    });
  }
  return slots;
}
