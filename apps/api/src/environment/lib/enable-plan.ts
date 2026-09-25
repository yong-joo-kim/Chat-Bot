/**
 * [신규 No.40] §5.3 — 켜기 확정의 "재사용 vs 새 버전" 판정. 순수 함수.
 * REUSE ⇔ `latest` 존재 ∧ `contentHash` 동일 ∧ `latest.tiebreakHash` 존재 ∧ `tiebreakHash` 동일
 * (발견 제약 ③ — 해시만으로는 동점 승자가 바뀐 과거 버전을 재사용할 위험이 있다).
 */
export function decideEnvInitVersion(input: {
  latest: { id: string; versionNo: number; contentHash: string; tiebreakHash: string | null } | null;
  captured: { contentHash: string; tiebreakHash: string | null };
}): { action: 'REUSE'; versionId: string; versionNo: number } | { action: 'CREATE' } {
  const { latest, captured } = input;
  if (latest && latest.contentHash === captured.contentHash && latest.tiebreakHash !== null && latest.tiebreakHash === captured.tiebreakHash) {
    return { action: 'REUSE', versionId: latest.id, versionNo: latest.versionNo };
  }
  return { action: 'CREATE' };
}
