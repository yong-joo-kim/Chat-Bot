import type { ResponseSource } from '@chat-bot/shared-types';

/**
 * 응답 출처 판정(FR-14-20, §7.3) — 순수 함수 1곳.
 * ⚠ 요구사항 FR-14-20의 서술 순서(노드→FAQ→기타→폴백)와 달리 **`isAnswered=false`를 최우선**으로
 * 판정한다. 폴백 노드가 답한 턴은 `matchedNodeId`가 채워진 채 `isAnswered=false`이므로(`judgeAnswered()`가
 * `FALLBACK_NODE` trace로 판정), 노드를 먼저 보면 폴백이 `NODE`로 잘못 집계돼 `bySource.FALLBACK`과
 * `totals.unansweredCount`가 어긋난다. 이 판정 순서가 그 불변식(`bySource.FALLBACK === totals.unansweredCount`)을
 * 보장하는 유일한 방법이다.
 *
 * [신규] `answeredByRag`(J-10, DD-82) 분기를 `matchedFaqId` 다음·`OTHER` 앞에 추가한다 — RAG
 * 응답은 `matchedNodeId`/`matchedFaqId`가 둘 다 null인 채 `isAnswered=true`라 이 분기가 없으면
 * 기존 `OTHER`와 구분되지 않는다(AC-N2-21). 기존 3조각(NODE/FAQ/FALLBACK)의 수치는 변하지
 * 않는다(AC-N4-10) — `answeredByRag=false`인 기존 행은 전부 그대로 `OTHER`로 떨어진다.
 */
export function classifyResponseSource(row: { matchedNodeId: string | null; matchedFaqId: string | null; isAnswered: boolean; answeredByRag?: boolean }): ResponseSource {
  if (!row.isAnswered) return 'FALLBACK';
  if (row.matchedNodeId != null) return 'NODE';
  if (row.matchedFaqId != null) return 'FAQ';
  if (row.answeredByRag) return 'RAG';
  return 'OTHER';
}
