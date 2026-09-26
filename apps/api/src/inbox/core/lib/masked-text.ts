import { maskPii } from '@chat-bot/pii-mask';

/**
 * [신규 No.42] `MaskedText` 브랜드 타입(ADR-0042 §6 · O-4) — `maskForInbox()`만 이 타입을 만들 수
 * 있다. `InboxStore`의 텍스트 인자 타입을 이걸로 두어 마스킹 누락을 컴파일 오류로 만든다(No.26
 * `ValidatedLegacyRequest` 선례).
 */
export type MaskedText = string & { readonly __brand: 'MaskedText' };

/**
 * PII 마스킹 1벌 래퍼(ADR-0013 여섯 번째 적용 지점) — 인박스 저장 직전 마지막 관문. 금지어
 * 마스킹(표시 이름만 필요)은 호출부가 먼저 거친 뒤 이 함수에 넘긴다(§6.4·§13.3).
 */
export function maskForInbox(text: string): MaskedText {
  return maskPii(text).maskedText as MaskedText;
}

/** 빈 문자열 전용(SYSTEM 항목 본문 — 마스킹을 거칠 필요가 없다). */
export const EMPTY_MASKED_TEXT = '' as MaskedText;
