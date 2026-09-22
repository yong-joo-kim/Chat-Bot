import { normalizeText } from '@chat-bot/shared-types';

/** 대화 파이프라인이 넘기는 입력 유형(DD-52) — `ConversationLog` 컬럼이 아니라 파라미터로 전달된다. */
export type InputKind = 'TEXT' | 'BUTTON_NODE' | 'BUTTON_MESSAGE';

export type CollectSkipReason = 'ANSWERED' | 'BLOCKED' | 'BUTTON_NODE' | 'EMPTY' | 'TOO_LONG';

export type CollectDecision = { collect: true; normalized: string } | { collect: false; reason: CollectSkipReason };

/**
 * 미응답 질문 수집 조건 5종 판정(FR-15-1/2, DD-52/53) — 순수 함수, DB·Nest 무의존(NFR-M1).
 * `isAnswered` 판정은 `judgeAnswered()`(conversation/lib)의 결과를 그대로 신뢰한다 — 별도 판정을
 * 만들지 않는다(DD-53). 전부 만족해야 수집한다.
 */
export function shouldCollect(input: {
  isAnswered: boolean;
  blockedByFilter: boolean;
  inputKind: InputKind;
  questionText: string;
  maxLength: number;
}): CollectDecision {
  if (input.isAnswered) return { collect: false, reason: 'ANSWERED' };
  if (input.blockedByFilter) return { collect: false, reason: 'BLOCKED' };
  if (input.inputKind === 'BUTTON_NODE') return { collect: false, reason: 'BUTTON_NODE' };

  const normalized = normalizeText(input.questionText);
  if (normalized.length === 0) return { collect: false, reason: 'EMPTY' };
  if (normalized.length > input.maxLength) return { collect: false, reason: 'TOO_LONG' };

  return { collect: true, normalized };
}
