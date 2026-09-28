/**
 * [신규 No.43 — R1 M-1 계약 보완] "미리보기가 낡았는가"의 핵심 비교(순수) — `approve-ingest`가
 * `PREVIEW_STALE`을 던지는 기준(`kb-runs.service.ts`)과 `KbSourceResponse.previewStale` 필드
 * (`kb-sources.service.ts`)가 **같은 함수**를 공유한다(판정 기준 드리프트 방지).
 */
export function isPreviewConfigStale(previewConfigVersion: number, currentConfigVersion: number): boolean {
  return previewConfigVersion !== currentConfigVersion;
}
