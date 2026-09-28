/**
 * [신규 No.35] 전화·이메일처럼 보이는 문자열 경고(차단 아님 — FR-PA7-2). 고객센터 번호 안내 같은
 * 정상 용도가 있어 저장은 막지 않고 `CONTACT_LIKE` 경고만 낸다. 순수 — DB·Nest 무의존.
 */

const PHONE_RE = /(?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function looksLikeContactInfo(text: string): boolean {
  return PHONE_RE.test(text) || EMAIL_RE.test(text);
}
