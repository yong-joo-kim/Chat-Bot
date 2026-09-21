import { normalizeText } from '@chat-bot/shared-types';

/** 정규화 단일 소스 re-export(DD-11, FR-0-12). 구현은 `@chat-bot/shared-types`에 있다. */
export { normalizeText };

/** 공백 단위 토큰화. 빈 토큰은 제거한다. */
export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 0);
}

/** 공백 토큰 자카드 유사도(FR-9-5). */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 한글 체언(명사) 뒤에 붙는 대표 조사 접미사 집합(형태소 분석기 미도입 — EX-X-5, 휴리스틱).
 * `containsWord`가 "토큰 == term" 뿐 아니라 "토큰 == term + 조사"까지 인정하는 데 쓰인다.
 * 예) "배가"(배+가), "항구에서"(항구+에서) — 반대로 "배송"(배+송)은 "송"이 조사가 아니므로
 * term "배"와 매치되지 않는다(오늘 재현된 "배송"↔"배" 오탐 방지가 이 화이트리스트의 존재 이유다).
 * 동사/형용사 활용 어미(-고, -며 등)는 일부러 제외한다 — 체언이 아닌 용언에 주로 붙어
 * 화이트리스트를 넓히면 오탐 위험이 다시 커진다.
 */
const JOSA_SUFFIXES = new Set([
  '은', '는', '이', '가', '을', '를', '의', '도', '만',
  '에', '에서', '에게', '에게서', '한테', '한테서', '께', '께서',
  '와', '과', '랑', '이랑', '나', '이나',
  '라도', '이라도', '야', '이야', '여', '이여',
  '로', '으로', '로서', '으로서', '로써', '으로써',
  '까지', '부터', '마저', '조차', '밖에', '요',
  '에다', '에다가', '란', '이란', '라면', '이라면', '인데',
]);

/** 입력 토큰이 term 토큰과 "동일" 또는 "term + 조사"로 일치하는지 판정한다. */
function tokenMatchesTerm(inputToken: string, termToken: string): boolean {
  if (inputToken === termToken) return true;
  if (!inputToken.startsWith(termToken)) return false;
  return JOSA_SUFFIXES.has(inputToken.slice(termToken.length));
}

/**
 * 입력 문자열에 term이 "단어 단위"로 포함되는지 판정한다(키워드 조건 판정, §7.3).
 * 정규화된 입력/용어를 받는다. 공백 토큰 경계를 기준으로 판정한다 — 순수 부분문자열
 * 포함(예: "배송"이 "배"를 포함)은 더 이상 인정하지 않는다.
 * term이 단일 토큰이면 입력 토큰 중 하나가 term과 동일하거나 term 뒤에 조사가 붙은
 * 형태여야 매치된다("배가"는 "배"에 매치, "배송"은 매치되지 않는다).
 * term이 다중 토큰(예: "환불 절차")이면 입력 토큰열에서 연속 부분열로 등장해야 매치되며,
 * 각 자리에서도 위와 동일한 동일/조사부착 규칙을 적용한다.
 */
export function containsWord(normalizedInput: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  const inputTokens = tokenize(normalizedInput);
  const termTokens = tokenize(normalizedTerm);
  if (termTokens.length === 0) return false;

  for (let start = 0; start + termTokens.length <= inputTokens.length; start += 1) {
    let allMatched = true;
    for (let offset = 0; offset < termTokens.length; offset += 1) {
      if (!tokenMatchesTerm(inputTokens[start + offset], termTokens[offset])) {
        allMatched = false;
        break;
      }
    }
    if (allMatched) return true;
  }
  return false;
}
