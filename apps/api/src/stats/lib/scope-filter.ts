/**
 * No.29 스코프 판정 — 단일 소스(FR-I3-2, NFR-IM1). 그룹·전역 스코프의 모든 `ConversationLog` 쿼리는
 * 이 함수가 만든 `where` 조각을 `dayBucket` 범위와 함께 선행 조건으로 쓴다.
 * DB·Nest 무의존 순수 함수.
 */
export type ResolvedScope = { scope: 'ALL' } | { scope: 'GROUP'; groupId: string };

/** ★ 챗봇 상태 조건을 절대 넣지 않는다(FR-I1-2) — 보관 챗봇의 로그도 항상 합계에 포함된다. */
export function scopeLogWhere(s: ResolvedScope): { groupId?: string } {
  return s.scope === 'GROUP' ? { groupId: s.groupId } : {};
}
