/**
 * 최근 표기 변형 샘플 병합(FR-15-4) — 순수 함수. 중복 제거 + 최신 우선 + 최대 `max`건 +
 * 각 항목 `maxLen`자 상한. 전량 보관하지 않는다(행 크기 예측 가능성, ADR-0019 감수 비용 4).
 */
export function mergeVariants(current: string[], next: string, max = 5, maxLen = 200): string[] {
  const trimmedNext = next.slice(0, maxLen);
  const withoutDup = current.filter((v) => v !== trimmedNext);
  return [trimmedNext, ...withoutDup].slice(0, max);
}
