/**
 * [신규 No.43] 글롭 매처(`*`·`?`만 — 정규식 아님, R-13) — 선형 시간(백트래킹 없음). 관리자가 입력하는
 * 제외·잡음 패턴은 정규식을 받지 않아 ReDoS를 원천 차단한다.
 *
 * [pass 7 · N-13] 핵심은 "단위" 배열/문자열 위에서 도는 `globMatchUnits`다 — `?`는 단위 1개, `*`는 단위 0개 이상. 일반 문자열은 글자(UTF-16 코드 유닛) 하나가 단위이고,
 * 경로 정준형(비ASCII가 `%XX%XX%XX`로 바뀐 형태)은 `path-canon.ts`의 `splitPathUnits()`로 "문자 1개"(한글 1자 = `%XX` 3개)를 한 단위로 묶어 넘긴다.
 */
export function globMatchUnits(pattern: ArrayLike<string>, text: ArrayLike<string>): boolean {
  const pLen = pattern.length;
  const tLen = text.length;

  let pIdx = 0;
  let tIdx = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (tIdx < tLen) {
    if (pIdx < pLen && (pattern[pIdx] === '?' || pattern[pIdx] === text[tIdx])) {
      pIdx += 1;
      tIdx += 1;
    } else if (pIdx < pLen && pattern[pIdx] === '*') {
      starIdx = pIdx;
      matchIdx = tIdx;
      pIdx += 1;
    } else if (starIdx !== -1) {
      pIdx = starIdx + 1;
      matchIdx += 1;
      tIdx = matchIdx;
    } else {
      return false;
    }
  }
  while (pIdx < pLen && pattern[pIdx] === '*') pIdx += 1;
  return pIdx === pLen;
}

export function globMatch(pattern: string, text: string): boolean {
  return globMatchUnits(pattern, text);
}

/** 목록 중 하나라도 일치하면 true(빈 목록 = 불일치 — 호출부가 "제외 규칙 없음"으로 해석한다). */
export function globMatchAny(patterns: readonly string[], text: string): boolean {
  return patterns.some((p) => globMatch(p, text));
}
