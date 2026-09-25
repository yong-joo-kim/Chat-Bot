import { normalizeText } from '@chat-bot/shared-types';

/** 대화 파이프라인이 넘기는 입력 유형(DD-52) — `ConversationLog` 컬럼이 아니라 파라미터로 전달된다. */
export type InputKind = 'TEXT' | 'BUTTON_NODE' | 'BUTTON_MESSAGE';

export type CollectSkipReason = 'ANSWERED' | 'BLOCKED' | 'BUTTON_NODE' | 'EMPTY' | 'TOO_LONG' | 'API_NOTICE' | 'SURVEY_TURN' | 'HANDOFF_TURN';

export type CollectDecision = { collect: true; normalized: string } | { collect: false; reason: CollectSkipReason };

/** [신규 No.44] 👎 편입 제외 사유(ADR-0038 §4) — `LIMIT_REACHED`는 상한 검사 단계에서만 나온다(수집기 판정). */
export type NegativeFeedbackSkipCode = 'ALREADY_UNANSWERED' | 'API_NOTICE' | 'BUTTON_NODE' | 'EMPTY' | 'TOO_LONG' | 'LIMIT_REACHED';

export type NegativeFeedbackQueueDecision =
  | { queue: true; normalized: string }
  | { queue: false; reason: Exclude<NegativeFeedbackSkipCode, 'LIMIT_REACHED'> };

/**
 * 정규화·빈 입력·장문 판정 1벌 — `shouldCollect()`와 `shouldQueueNegativeFeedback()`이 공유한다
 * (복제 금지, NFR-FBM2).
 */
function normalizeQueueCandidate(text: string, maxLength: number): { ok: true; normalized: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' } {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return { ok: false, reason: 'EMPTY' };
  if (normalized.length > maxLength) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, normalized };
}

/**
 * 미응답 질문 수집 조건 판정(FR-15-1/2, DD-52/53) — 순수 함수, DB·Nest 무의존(NFR-M1).
 * `isAnswered` 판정은 `judgeAnswered()`(conversation/lib)의 결과를 그대로 신뢰한다 — 별도 판정을
 * 만들지 않는다(DD-53). 전부 만족해야 수집한다.
 * [No.26 추가] `apiNotice`(외부 API 고정 문구 턴)는 학습 공백이 아니라 외부 장애다 — 문서 검색으로
 * 덮으면 틀린 답이 된다(ADR-0034 §5). 기본 false — 기존 호출 무변경.
 * [No.27 추가] `surveyTurn`(설문이 소비한 턴)도 학습 공백이 아니다 — 응답자 전원이 같은 값을
 * 반복해 미응답 큐를 오염시킨다(ADR-0019). 기본 false.
 * [No.24 추가] `handoffTurn`(상담 구간 턴)도 학습 공백이 아니다 — 상담원이 이미 응대했다
 * (ADR-0036 §1, FR-CS11-3). 기본 false.
 */
export function shouldCollect(input: {
  isAnswered: boolean;
  blockedByFilter: boolean;
  inputKind: InputKind;
  questionText: string;
  maxLength: number;
  apiNotice?: boolean;
  surveyTurn?: boolean;
  handoffTurn?: boolean;
}): CollectDecision {
  if (input.apiNotice) return { collect: false, reason: 'API_NOTICE' };
  if (input.surveyTurn) return { collect: false, reason: 'SURVEY_TURN' };
  if (input.handoffTurn) return { collect: false, reason: 'HANDOFF_TURN' };
  if (input.isAnswered) return { collect: false, reason: 'ANSWERED' };
  if (input.blockedByFilter) return { collect: false, reason: 'BLOCKED' };
  if (input.inputKind === 'BUTTON_NODE') return { collect: false, reason: 'BUTTON_NODE' };

  const normalized = normalizeQueueCandidate(input.questionText, input.maxLength);
  if (!normalized.ok) return { collect: false, reason: normalized.reason };

  return { collect: true, normalized: normalized.normalized };
}

/**
 * [신규 No.44] 👎 큐 편입 판정(ADR-0038 §4) — 순수 함수. 제외 순서: `API_NOTICE`(외부 장애) →
 * `ALREADY_UNANSWERED`(폴백은 이미 UNANSWERED로 수집됨) → `BUTTON_NODE`(`inputKind`가 TEXT·
 * BUTTON_MESSAGE가 아님 — null 포함, 보수적) → `EMPTY`/`TOO_LONG`. 상한(`LIMIT_REACHED`)은 이
 * 함수가 아니라 수집기가 판정한다(PENDING 건수 조회가 필요해서다).
 */
export function shouldQueueNegativeFeedback(input: {
  isAnswered: boolean;
  apiNotice: boolean;
  inputKind: string | null;
  questionText: string;
  maxLength: number;
}): NegativeFeedbackQueueDecision {
  if (input.apiNotice) return { queue: false, reason: 'API_NOTICE' };
  if (!input.isAnswered) return { queue: false, reason: 'ALREADY_UNANSWERED' };
  if (input.inputKind !== 'TEXT' && input.inputKind !== 'BUTTON_MESSAGE') return { queue: false, reason: 'BUTTON_NODE' };

  const normalized = normalizeQueueCandidate(input.questionText, input.maxLength);
  if (!normalized.ok) return { queue: false, reason: normalized.reason };

  return { queue: true, normalized: normalized.normalized };
}
