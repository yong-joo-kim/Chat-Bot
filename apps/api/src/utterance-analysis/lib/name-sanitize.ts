import { maskPii } from '@chat-bot/pii-mask';

/**
 * 묶음 이름(AI 제안) 출력 검사(No.21 — 설계서 §16.5, NFR-DCS4 · FR-DC8-4 · EX-DC-16). DB·Nest 무의존 순수 함수.
 *
 * 통과해야 `suggestedName`에 저장한다:
 *  ① trim · 줄바꿈·탭 제거 · 마크다운 기호(`*`·`#`·`` ` ``·`>`)·앞뒤 따옴표 제거
 *  ② 길이 2~30자
 *  ③ 한글이 전체(공백 제외) 글자의 50% 이상(영문 출력 탈락 — AC-DC6-2)
 *  ④ 금지어 탐지 0
 *  ⑤ `maskPii(name).maskedText === name`(개인정보 모양 0)
 *  ⑥ 마스킹 표식·`*` 0
 *  ⑦ URL·`@` 0
 * 하나라도 실패 = `null`(그 묶음은 키워드 이름만 쓴다).
 *
 * 금지어 사전 조회는 비동기라 이 함수가 하지 않는다 — 호출부가 ①의 정규화 결과(`normalizeSuggestedName`)에
 * 금지어 탐지를 돌려 그 결과(`bannedDetected`)를 넘긴다.
 */

export const SUGGESTED_NAME_MIN = 2;
export const SUGGESTED_NAME_MAX = 30;

/** ① — 줄바꿈·탭 → 공백, 마크다운 기호 제거, 앞뒤 따옴표 제거, trim. */
export function normalizeSuggestedName(raw: string): string {
  let s = raw.replace(/[\r\n\t]+/g, ' ').replace(/[*#`>]/g, '');
  s = s.trim();
  // 앞뒤 따옴표(직선·둥근·꺾쇠) 반복 제거
  const quotes = /^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g;
  s = s.replace(quotes, '').trim();
  return s.replace(/\s+/g, ' ');
}

function hangulRatio(name: string): number {
  const chars = [...name.replace(/\s/g, '')];
  if (chars.length === 0) return 0;
  const hangul = chars.filter((c) => /[가-힣ㄱ-ㆎ]/.test(c)).length;
  return hangul / chars.length;
}

const MASK_TOKEN_LIKE = /\[(?:주민등록번호|카드번호|전화번호|계좌번호|이메일)\]|\*|\[|\]/;
const URL_OR_AT = /https?:\/\/|www\.|@/i;

/** ②~⑦ 검사. 통과하면 정규화된 이름, 아니면 `null`. */
export function checkSuggestedName(normalized: string, bannedDetected: boolean): string | null {
  const len = [...normalized].length;
  if (len < SUGGESTED_NAME_MIN || len > SUGGESTED_NAME_MAX) return null; // ②
  if (hangulRatio(normalized) < 0.5) return null; // ③
  if (bannedDetected) return null; // ④
  if (maskPii(normalized).maskedText !== normalized) return null; // ⑤
  if (MASK_TOKEN_LIKE.test(normalized)) return null; // ⑥
  if (URL_OR_AT.test(normalized)) return null; // ⑦
  return normalized;
}
