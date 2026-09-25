/**
 * [신규 No.40] §13.2 — 환경 포인터·운영 이력 보존 보호 집합(순수 함수). `versions/capture`(보존
 * 정리)와 `environment/core`(보존 정리 입력)가 공유한다 — `versions → environment/** import 0`
 * 규약을 지키려고 이 파일을 `versions/lib/`에 둔다(환경 전용 개념이지만 위치는 versions 쪽).
 */
export function computeEnvironmentProtectedIds(input: {
  prodVersionId: string | null;
  stagingVersionId: string | null;
  prodHistoryDesc: ReadonlyArray<{ toVersionId: string | null }>;
  historyN: number;
}): Set<string> {
  const set = new Set<string>();
  if (input.prodVersionId) set.add(input.prodVersionId);
  if (input.stagingVersionId) set.add(input.stagingVersionId);

  let added = 0;
  for (const entry of input.prodHistoryDesc) {
    if (added >= input.historyN) break;
    if (!entry.toVersionId || entry.toVersionId === input.prodVersionId) continue;
    if (set.has(entry.toVersionId)) continue;
    set.add(entry.toVersionId);
    added += 1;
  }
  return set;
}
