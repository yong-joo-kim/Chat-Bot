/**
 * [신규 No.32] 한글 숫자열 → 아라비아 숫자(voice-ai-설계.md §7.4 ④ · DD-131 · P-16). 순수 — DB·Nest·시계 무의존.
 *
 * 규칙(**확정 대기 — 3050 실측 후 ml-engineer가 확정**, 확정 전까지 아래 제안 규칙을 쓴다):
 *  - 숫자 음절: 공·영=0 일=1 이=2 삼=3 사=4 오=5 육·륙=6 칠=7 팔=8 구=9
 *  - 구분: 공백·하이픈, 단어 "다시"는 구두 하이픈('-')으로 읽는다
 *  - 토큰이 **전부 숫자 음절**이고 연속 구간의 숫자 합계가 6자리 이상일 때만 변환한다
 *  - 구분 군집은 하이픈으로 이어 붙인다: "공일공 일이삼사 오육칠팔" → 010-1234-5678,
 *    "구공공일일이 다시 일이삼사오육칠" → 900112-1234567
 *  - 비변환: "사이사이"(4자리) · "이사"(2자리) · "일이삼사오"(5자리) · "오육십"(십은 숫자 음절 아님) · 자릿값 읽기("천이백") ·
 *    한글·숫자 혼합(아라비아 숫자가 붙은 토큰이 맞닿아 있는 구간 포함)
 */

/** 연속 구간 변환 최소 자릿수 — 확정 대기(3050 실측 후). */
export const KOREAN_DIGITS_MIN_LENGTH = 6;

/** 숫자 음절 → 숫자 — 확정 대기(3050 실측 후). */
export const KOREAN_DIGIT_SYLLABLES: Readonly<Record<string, string>> = {
  공: '0',
  영: '0',
  일: '1',
  이: '2',
  삼: '3',
  사: '4',
  오: '5',
  육: '6',
  륙: '6',
  칠: '7',
  팔: '8',
  구: '9',
};

/** 구두 하이픈 단어 — 확정 대기(3050 실측 후). */
export const KOREAN_DIGITS_DASH_WORD = '다시';

interface Token {
  readonly text: string;
  readonly sep: boolean;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const isSep = /\s|-/.test(input[i]);
    let j = i + 1;
    while (j < input.length && /\s|-/.test(input[j]) === isSep) j += 1;
    tokens.push({ text: input.slice(i, j), sep: isSep });
    i = j;
  }
  return tokens;
}

function isDigitWord(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text) if (!(ch in KOREAN_DIGIT_SYLLABLES)) return false;
  return true;
}

function toDigits(text: string): string {
  let out = '';
  for (const ch of text) out += KOREAN_DIGIT_SYLLABLES[ch];
  return out;
}

/** 아라비아 숫자가 한 글자라도 들어 있는 토큰("010"·"공1공") — 한글·숫자 혼합 판정용. */
function hasArabicDigit(text: string): boolean {
  return /[0-9]/.test(text);
}

export function normalizeKoreanDigits(input: string): string {
  if (input.length === 0) return input;
  const tokens = tokenize(input);
  let out = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.sep || !isDigitWord(t.text)) {
      out += t.text;
      i += 1;
      continue;
    }
    // 숫자 음절 토큰에서 시작하는 최대 연속 구간을 모은다(사이 구분은 공백·하이픈, "다시"는 숫자 토큰 사이에서만 허용).
    let end = i; // 마지막 숫자 토큰의 인덱스
    let k = i + 1;
    while (k < tokens.length) {
      if (!tokens[k].sep) break;
      const next = tokens[k + 1];
      if (!next || next.sep) break;
      if (isDigitWord(next.text)) {
        end = k + 1;
        k += 2;
        continue;
      }
      if (next.text === KOREAN_DIGITS_DASH_WORD) {
        // "다시" 뒤에 구분 + 숫자 토큰이 이어질 때만 구간에 포함한다.
        const sep2 = tokens[k + 2];
        const after = tokens[k + 3];
        if (sep2 && sep2.sep && after && !after.sep && isDigitWord(after.text)) {
          end = k + 3;
          k += 4;
          continue;
        }
      }
      break;
    }

    // 구간의 숫자 합계·혼합 판정.
    let digitCount = 0;
    for (let n = i; n <= end; n += 1) if (!tokens[n].sep && isDigitWord(tokens[n].text)) digitCount += tokens[n].text.length;
    const before = tokens[i - 2];
    const beforeSep = tokens[i - 1];
    const after = tokens[end + 2];
    const afterSep = tokens[end + 1];
    const mixedBefore = !!beforeSep && beforeSep.sep && !!before && !before.sep && hasArabicDigit(before.text);
    const mixedAfter = !!afterSep && afterSep.sep && !!after && !after.sep && hasArabicDigit(after.text);

    if (digitCount >= KOREAN_DIGITS_MIN_LENGTH && !mixedBefore && !mixedAfter) {
      const clusters: string[] = [];
      let spelledOut = true; // 낱글자(1글자 토큰)만 공백으로 끊어 읽은 경우(M-1) — 군집이 아니라 한 자리씩 읽은 것
      for (let n = i; n <= end; n += 1) {
        const tok = tokens[n];
        if (tok.sep) {
          if (tok.text.includes('-')) spelledOut = false;
          continue;
        }
        if (tok.text === KOREAN_DIGITS_DASH_WORD || tok.text.length !== 1) spelledOut = false;
        if (tok.text === KOREAN_DIGITS_DASH_WORD) continue;
        clusters.push(toDigits(tok.text));
      }
      out += clusters.join(spelledOut ? '' : '-');
    } else {
      for (let n = i; n <= end; n += 1) out += tokens[n].text;
    }
    i = end + 1;
  }
  return out;
}
