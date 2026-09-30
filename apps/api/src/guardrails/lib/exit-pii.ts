import { maskPii } from '@chat-bot/pii-mask';
import type { PiiKind } from '@chat-bot/pii-mask';
import { GUARDRAIL_PII_DEFAULT_KINDS } from '@chat-bot/shared-types';
import type { GuardrailPiiKind } from '@chat-bot/shared-types';

/**
 * ★ `maskPii(text, { kinds, preserveDates })` 호출 유일 파일(AG-7 · GR-5) — RAG 답 출구 전용 선택 가림.
 * 저장 마스킹(`ConversationLog`)·송신 마스킹(RAG 질의·증강·레거시·웹훅·인박스·KB 적재)은 인자 없는
 * 기존 호출을 그대로 쓴다. 강도(부분/전량)는 서버의 `PII_MASK_MODE`를 따른다(R-11).
 */

const KIND_TO_PII: Record<GuardrailPiiKind, PiiKind> = {
  RRN: 'rrn',
  CARD: 'card',
  ACCOUNT: 'account',
  PHONE: 'phone',
  EMAIL: 'email',
};

const PII_TO_KIND: Record<PiiKind, GuardrailPiiKind> = {
  rrn: 'RRN',
  card: 'CARD',
  account: 'ACCOUNT',
  phone: 'PHONE',
  email: 'EMAIL',
};

export interface ExitMaskResult {
  maskedText: string;
  counts: Partial<Record<GuardrailPiiKind, number>>;
}

/** 종류 배열 정규화 — 중복 제거 · 닫힌 집합 밖 값 버림 · 정해진 순서. */
export function normalizeKinds(kinds: readonly string[]): GuardrailPiiKind[] {
  const wanted = new Set(kinds);
  return (Object.keys(KIND_TO_PII) as GuardrailPiiKind[]).filter((k) => wanted.has(k));
}

/** 거버넌스 모드 ON이면 `RRN`·`CARD`는 합집합으로 강제한다(하한 — 런타임도 강제, §7.4). */
export function applyGovernanceFloor(kinds: readonly GuardrailPiiKind[], governanceOn: boolean): GuardrailPiiKind[] {
  if (!governanceOn) return normalizeKinds(kinds);
  return normalizeKinds([...kinds, ...GUARDRAIL_PII_DEFAULT_KINDS]);
}

export function governanceFloorKinds(governanceOn: boolean): GuardrailPiiKind[] {
  return governanceOn ? [...GUARDRAIL_PII_DEFAULT_KINDS] : [];
}

/** 선택된 종류만 가린다. 종류가 없으면 원문 그대로(현행과 동일 — AC-AG4-6). */
export function maskExit(text: string, kinds: readonly GuardrailPiiKind[], preserveDates: boolean): ExitMaskResult {
  if (kinds.length === 0 || !text) return { maskedText: text, counts: {} };
  const result = maskPii(text, { kinds: kinds.map((k) => KIND_TO_PII[k]), preserveDates });
  const counts: Partial<Record<GuardrailPiiKind, number>> = {};
  for (const key of Object.keys(result.counts) as PiiKind[]) {
    if (result.counts[key] > 0) counts[PII_TO_KIND[key]] = result.counts[key];
  }
  return { maskedText: result.maskedText, counts };
}

// 마스킹 토큰(전량) · 부분 마스킹 모양(전화 `010-****-5678` · 이메일 `a***@example.com`).
const TOKEN_REGEX = /\[(?:주민등록번호|카드번호|계좌번호|전화번호|이메일)\]|\d{2,3}-\*{4}-\d{4}|\S\*{3}@[A-Za-z0-9.-]+/g;

/** 가린 텍스트에서 마스킹 토큰·공백·문장부호를 지웠을 때 글자가 하나도 남지 않으면 true(EX-AG-8). */
export function isTokensOnly(maskedText: string): boolean {
  const rest = maskedText.replace(TOKEN_REGEX, '').replace(/[\s\p{P}\p{S}]/gu, '');
  return rest.length === 0;
}

export function totalCount(counts: Partial<Record<GuardrailPiiKind, number>>): number {
  return Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
}
