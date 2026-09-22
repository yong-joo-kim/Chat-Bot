/**
 * 변경 필드 산출(FR-13-18, NFR-M1). `simulation/lib/compare-diff.ts`는 아웃풋 시퀀스 비교용이라
 * 자료구조가 달라 재사용하지 않는다(검토 결과 부적합, ADR-0016 §9.6).
 */
export function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key])) changed.push(key);
  }
  return changed;
}
