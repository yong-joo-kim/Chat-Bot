/**
 * 의미 매칭 ranked(상위 N, FAQ/INTENT 혼합, 이미 점수 내림차순)에서 힌트 후보 상위 개수를 고른다
 * (순수 함수, §12.2). 텍스트 해석(FAQ 답변·의도의 대표 노드 텍스트 조회)은 DB·번들에 의존하므로
 * 호출부(`handoff-hints.service.ts`)가 담당한다 — 이 함수는 순서·개수만 책임진다.
 */
export interface SemanticHintCandidate {
  kind: 'FAQ' | 'INTENT';
  id: string;
  score: number;
}

export function pickTopSemanticCandidates<T extends SemanticHintCandidate>(ranked: readonly T[], max = 3): T[] {
  return ranked.slice(0, max);
}
