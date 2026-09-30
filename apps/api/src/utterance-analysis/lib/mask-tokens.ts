/**
 * 마스킹 표식 식별(No.21 — 설계서 §6.1 ①, FR-DC4-4). 분석에 올라오는 문장은 이미 금지어 → PII 마스킹을
 * 거쳤으므로 `[전화번호]`·`010-****-1234`·`a***@x.com`·`****` 같은 표식이 섞여 있다. 이 표식이 형태소
 * 분석에 들어가 "전화번호"가 묶음 대표 키워드가 되는 것을 막는다.
 *
 * 패턴의 원천은 `@chat-bot/pii-mask`의 `maskPii()` 출력 형식(`[주민등록번호]`·`[카드번호]`·`[전화번호]`·
 * `[계좌번호]`·`[이메일]` · 부분 마스킹 `DDD-****-DDDD`·`X***@domain`)과 금지어 마스킹(`*` 연속)이다.
 * **마스킹 규칙이 바뀌면 `mask-tokens.spec.ts`의 결합 시험(실제 `maskPii()` 출력 사용)이 먼저 깨진다.**
 * DB·Nest 무의존 순수 함수.
 */

/** 적용 순서가 의미를 가진다(이메일 부분 마스킹의 `***`을 `\*{2,}`보다 먼저 처리). */
export const MASK_TOKEN_PATTERNS: readonly RegExp[] = [
  /\[(?:주민등록번호|카드번호|전화번호|계좌번호|이메일)\]/g,
  /\S\*\*\*@\S+/g, // 부분 마스킹 이메일 — a***@domain.com
  /\d{3}-\*{4}-\d{4}/g, // 부분 마스킹 전화 — 010-****-1234
  /\*{2,}/g, // 금지어 마스킹
];

/** 마스킹 표식을 공백으로 바꾼다(길이·어절 경계가 붙어 버리지 않게). */
export function stripMaskTokens(text: string): string {
  let out = text;
  for (const re of MASK_TOKEN_PATTERNS) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/** 표식 제거 후에도 `*` 잔여가 있는지(있으면 그 토큰은 키워드 후보에서 제외). */
export function hasMaskResidue(term: string): boolean {
  return term.includes('*') || /\[(?:주민등록번호|카드번호|전화번호|계좌번호|이메일)\]/.test(term);
}
