import type { ResponseSource } from '@chat-bot/shared-types';

/**
 * 응답 출처 판정(FR-14-20, §7.3) — 순수 함수 1곳.
 * ⚠ 요구사항 FR-14-20의 서술 순서(노드→FAQ→기타→폴백)와 달리 **`isAnswered=false`를 최우선**으로
 * 판정한다. 폴백 노드가 답한 턴은 `matchedNodeId`가 채워진 채 `isAnswered=false`이므로(`judgeAnswered()`가
 * `FALLBACK_NODE` trace로 판정), 노드를 먼저 보면 폴백이 `NODE`로 잘못 집계돼 `bySource.FALLBACK`과
 * `totals.unansweredCount`가 어긋난다. 이 판정 순서가 그 불변식(`bySource.FALLBACK === totals.unansweredCount`)을
 * 보장하는 유일한 방법이다.
 */
export function classifyResponseSource(row: { matchedNodeId: string | null; matchedFaqId: string | null; isAnswered: boolean }): ResponseSource {
  if (!row.isAnswered) return 'FALLBACK';
  if (row.matchedNodeId != null) return 'NODE';
  if (row.matchedFaqId != null) return 'FAQ';
  return 'OTHER';
}
