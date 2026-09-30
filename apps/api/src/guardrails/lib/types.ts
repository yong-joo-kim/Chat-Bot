import type {
  BannedWordMatchType,
  GuardrailAction,
  GuardrailAppliesTo,
  GuardrailCategory,
  GuardrailPiiKind,
  GuardrailStage,
} from '@chat-bot/shared-types';

/**
 * 가드레일 판정 순수 타입(DB·Nest 무의존 — NFR-AGM1). 설계서 §4.5.
 */

/** 저장 행을 파싱한 컴파일 입력(표현 JSON 파싱 후). */
export interface GuardrailRuleRow {
  id: string;
  name: string;
  category: GuardrailCategory;
  expressions: string[];
  matchType: BannedWordMatchType;
  appliesTo: GuardrailAppliesTo;
  action: GuardrailAction;
  replacementText: string | null;
  sortOrder: number;
  createdAt: Date;
}

/** 적중 규칙 1건 — `matched`(원문 표현)는 이벤트·로그에 싣지 않는다. */
export interface RuleHit {
  ruleId: string;
  ruleName: string;
  category: GuardrailCategory;
  action: GuardrailAction;
  sortOrder: number;
  matched: string[];
}

export type InboundAction = 'PASS' | 'MONITOR' | 'NO_RAG' | 'REPLACE';

export interface InboundVerdict {
  action: InboundAction;
  replacementText?: string;
  decisiveRuleId?: string;
  hits: RuleHit[];
}

export type OutboundKind = 'PASS' | 'MONITOR' | 'MASKED' | 'REPLACE' | 'FALLBACK';
export type OutboundFallbackReason = 'PII_ONLY' | 'ERROR' | 'PROFILE_UNAVAILABLE';

export interface OutboundVerdict {
  kind: OutboundKind;
  /** PASS·MONITOR·MASKED일 때 사용자에게 나갈 텍스트(출구 금지어 전). */
  text: string;
  replacementText?: string;
  decisiveRuleId?: string;
  fallbackReason?: OutboundFallbackReason;
  hits: RuleHit[];
  piiCounts: Partial<Record<GuardrailPiiKind, number>>;
  /** 예외 클래스 이름 수준(메시지·문장 0). PASS + errorCode = "판정 오류지만 원답 통과"(FR-AG3-6). */
  errorCode?: string;
}

export interface GuardrailEventContext {
  chatbotId: string;
  messageId: string;
  now: Date;
}

export type { GuardrailStage };
