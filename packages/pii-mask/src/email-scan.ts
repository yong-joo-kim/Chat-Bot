/**
 * [L-6, 2026-10-01] 이메일 치환 — 구 `EMAIL_REGEX`(`/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g`)와
 * **결과가 동일한** 선형 시간 스캔. 구 정규식은 `@`가 뒤따르지 않는 긴 로컬 문자 연속에서 시작 위치마다
 * 연속의 끝까지 다시 읽어 O(n²)였다.
 *
 * 결과 동일 논증(`docs/02-spec/followup-defects-2026-10-01-설계.md` §4.4): 같은 로컬 문자 연속 안의 두 시작
 * 위치는 같은 `@`·같은 도메인으로 이어지므로 성공 여부와 끝 위치가 같다. 따라서 검색 시작 위치 s 이후 가장
 * 왼쪽 일치의 시작은 (ⓐ) s 자신(s가 로컬 문자일 때) 또는 (ⓑ) s 뒤의 "로컬 문자 연속의 처음"이다. s의 앞
 * 글자가 로컬 문자인 경우는 s가 직전 일치의 끝일 때뿐이다(`String.prototype.replace`는 직전 일치 끝에서
 * 검색을 이어 간다) — 그때만 고정 위치(sticky) 시도로 ⓐ를 처리하고, 그 밖에는 되돌아보기로 연속의 처음에서만
 * 시작한다. 패키지 외부로 export하지 않는다(`index.ts` 전용).
 */

const L = 'a-zA-Z0-9._%+-';
const TAIL = String.raw`@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`;
/** 직전 일치 끝에서만 시도(고정 위치). */
const EMAIL_AT_POS = new RegExp(`[${L}]+${TAIL}`, 'y');
/** 로컬 문자 연속의 처음에서만 시작. */
const EMAIL_AT_RUNSTART = new RegExp(`(?<![${L}])[${L}]+${TAIL}`, 'g');

/** `input`의 이메일 일치마다 `replacer(일치)`로 치환한 문자열을 돌려준다(구 정규식 `replace`와 같은 결과·같은 호출 순서). */
export function replaceEmails(input: string, replacer: (match: string) => string): string {
  let pos = 0;
  let prevEnd = -1;
  let out = '';
  for (;;) {
    let m: RegExpExecArray | null = null;
    if (pos === prevEnd) {
      EMAIL_AT_POS.lastIndex = pos;
      m = EMAIL_AT_POS.exec(input);
    }
    if (!m) {
      EMAIL_AT_RUNSTART.lastIndex = pos;
      m = EMAIL_AT_RUNSTART.exec(input);
    }
    if (!m) break;
    out += input.slice(pos, m.index) + replacer(m[0]);
    pos = prevEnd = m.index + m[0].length;
  }
  return out + input.slice(pos);
}
