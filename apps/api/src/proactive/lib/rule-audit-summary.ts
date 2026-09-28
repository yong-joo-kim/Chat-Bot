/**
 * [신규 No.35] 감사 요약용 "바뀐 항목 이름" 목록 — 문구·버튼 원문은 절대 담지 않는다(FR-PA7-5).
 * 순수 — DB·Nest 무의존.
 */

const FIELD_LABELS: Record<string, string> = {
  name: '이름',
  trigger: '조건',
  text: '문구',
  buttons: '버튼',
  devices: '기기',
  startsAt: '게시 시작',
  endsAt: '게시 종료',
  schedule: '표시 시간대',
};

/** 값 비교는 `JSON.stringify` 동치(문자열·Date·원시값 모두 안전) — 반환은 필드 **이름**만. */
export function buildRuleChangeSummary(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]): string[] {
  const changed: string[] = [];
  for (const field of fields) {
    const beforeValue = normalize(before[field]);
    const afterValue = normalize(after[field]);
    if (beforeValue !== afterValue) changed.push(FIELD_LABELS[field] ?? field);
  }
  return changed;
}

function normalize(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
}
