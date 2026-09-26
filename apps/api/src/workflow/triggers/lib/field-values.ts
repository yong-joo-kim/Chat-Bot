import { maskPii } from '@chat-bot/pii-mask';
import { WORKFLOW_LIMITS } from '@chat-bot/shared-types';

/** 탭을 제외한 제어 문자(`\p{Cc}`) 제거 — 순수. */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '');
}

function truncateCodePoints(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join('') : value;
}

export interface ProcessedField {
  name: string;
  value: string;
  masked: boolean;
}

/**
 * [신규 No.41] 필드 값 가공(§11.1) — 순서: ① 제어 문자 제거 ② 500자 절단 ③ SLOT ∧ !allowRawPersonalData
 * → `maskPii()` ④ CONST는 마스킹하지 않는다(No.26 규약). ADR-0013 5번째 적용 지점.
 */
export function processFieldValue(name: string, rawValue: string, source: 'CONST' | 'SLOT', allowRawPersonalData: boolean): ProcessedField {
  let value = stripControlChars(rawValue);
  value = truncateCodePoints(value, WORKFLOW_LIMITS.fieldValueMax);

  if (source === 'SLOT' && !allowRawPersonalData) {
    const masked = maskPii(value);
    const changed = masked.maskedText !== value;
    return { name, value: masked.maskedText, masked: changed };
  }

  return { name, value, masked: false };
}
