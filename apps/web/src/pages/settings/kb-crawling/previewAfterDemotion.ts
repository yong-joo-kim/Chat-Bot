import type { KbRunView, KbSourceResponse } from '@chat-bot/shared-types';

/**
 * [No.43 RG-27 · pass 11 L-B] "적재 시작" 사전 비활성 판정 — 서버 `approveIngest`의 강등 규칙과 같은 기준.
 *
 * 서버는 `source.reviewRequiredReason`(자동 강등)이 있을 때, 미리보기의 종료 시각이 "강등이 실제로
 * 소스 승인을 해제한 가장 최근 실행"의 종료 시각보다 **먼저**이면(`<`) 409 `PREVIEW_STALE`로 거절한다.
 * 강등이 승인을 해제한 실행 = SYNC·FULL_RESEND의 모든 강등 + PREVIEW의 `NEW_RATIO` 강등
 * (PREVIEW의 `AUTH_WALL`은 기록만 하므로 제외). 강등을 만든 실행이 그 미리보기 자신이면 종료 시각이 같아 통과한다.
 *
 * 콘솔은 실행 이력 첫 페이지(최근 N건)만 안다. 그 안에서 찾은 가장 늦은 강등 종료 시각은 서버 값의
 * **하한**이므로, 미리보기가 그 하한보다 먼저 끝났다면 서버도 반드시 거절한다(확실). 창 안에 강등 실행이
 * 없거나 종료 시각이 없으면 모르는 것이므로 `false`(활성 유지 — 서버 409가 폴백).
 */
export function isPreviewOlderThanDemotion(
  source: Pick<KbSourceResponse, 'reviewRequiredReason'>,
  runs: readonly KbRunView[],
  previewRun: Pick<KbRunView, 'finishedAt'> | undefined,
): boolean {
  if (!source.reviewRequiredReason || !previewRun?.finishedAt) return false;
  const previewFinishedAt = new Date(previewRun.finishedAt).getTime();
  if (Number.isNaN(previewFinishedAt)) return false;

  let demotedAt: number | null = null;
  for (const run of runs) {
    if (!run.demotedReason || !run.finishedAt) continue;
    if (run.kind === 'PREVIEW' && run.demotedReason !== 'NEW_RATIO') continue;
    const t = new Date(run.finishedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (demotedAt === null || t > demotedAt) demotedAt = t;
  }
  return demotedAt !== null && previewFinishedAt < demotedAt;
}
