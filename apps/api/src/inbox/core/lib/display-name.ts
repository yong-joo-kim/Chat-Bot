import { maskForInbox } from './masked-text';
import type { MaskedText } from './masked-text';

/**
 * [신규 No.42] 표시 이름 정리 순수 함수(§6.4) — NFC 정규화 → 제어·양방향 제어 문자 제거 →
 * 40 코드포인트 절단. 금지어·PII 마스킹은 호출부(`inbox-identity.service.ts`·`inbox-customers.service.ts`·
 * `inbox-test-customers.service.ts`)가 이 함수 다음 단계로 적용한다.
 */

// U+202A~202E(LRE/RLE/PDF/LRO/RLO) · U+2066~2069(LRI/RLI/FSI/PDI) · 그 외 C0/C1 제어문자.
// eslint-disable-next-line no-control-regex
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

export function sanitizeDisplayName(raw: string, maxCodePoints = 40): string {
  const normalized = raw.normalize('NFC').replace(CONTROL_AND_BIDI_PATTERN, '');
  const codePoints = Array.from(normalized);
  const truncated = codePoints.length > maxCodePoints ? codePoints.slice(0, maxCodePoints).join('') : normalized;
  return truncated.trim();
}

/** 금지어 필터의 최소 계약 — `BannedWordFilterService`가 이를 만족한다(순환 import 방지용 최소 타입). */
export interface BannedWordMasker {
  maskPlainText(text: string): Promise<string>;
}

/**
 * [코드리뷰 R1 반영 M-2] 표시 이름 정리 공용 파이프라인 — `sanitizeDisplayName()` → 금지어 마스킹 →
 * `maskForInbox()`(§6.4와 같은 순서). 식별 서비스·새 익명 고객·시험 고객 생성 3곳이 공유한다.
 * 정리 결과가 빈 문자열이면 `undefined`(표시 이름 없음)를 반환한다.
 */
export async function prepareDisplayName(raw: string, bannedWordFilter: BannedWordMasker, maxCodePoints = 40): Promise<MaskedText | undefined> {
  const sanitized = sanitizeDisplayName(raw, maxCodePoints);
  if (sanitized.length === 0) return undefined;
  const bannedMasked = await bannedWordFilter.maskPlainText(sanitized);
  return maskForInbox(bannedMasked);
}
