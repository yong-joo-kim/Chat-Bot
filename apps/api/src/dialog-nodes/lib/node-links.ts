/** 조인 테이블에 넣을 ID 목록 중복 제거(DD-15 트랜잭션 입력 — createMany 유니크 위반 방지). */
export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
