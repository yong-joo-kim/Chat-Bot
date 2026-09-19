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
 * 입력 문자열에 term이 "단어 단위"로 포함되는지 판정한다(키워드 조건 판정, §7.3).
 * 정규화된 입력/용어를 받는다. 한글은 공백 경계 기준, term이 통짜로 포함되면 인정한다
 * (형태소 분석기 미도입 — EX-X-5).
 */
export function containsWord(normalizedInput: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  return normalizedInput.includes(normalizedTerm);
}
