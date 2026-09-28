import { KST_OFFSET_MINUTES } from '@chat-bot/shared-types';

/**
 * [신규 No.43] 적재 레인 판정(순수 — §9.7 · R-22). 대량 첫 적재(수 시간)는 BULK 레인 + 선택 시간창으로
 * 분리하고, 소량 변경은 INCREMENTAL로 즉시 처리한다.
 */
export function decideIngestLane(params: { jobCountInRun: number; isFullResend: boolean; isFirstIngestForSource: boolean }): 'BULK' | 'INCREMENTAL' {
  if (params.isFullResend || params.isFirstIngestForSource || params.jobCountInRun > 50) return 'BULK';
  return 'INCREMENTAL';
}

/** `window`는 `"HH:MM-HH:MM"`(KST) 또는 빈 문자열(항상 허용). 자정을 넘는 구간(예: 19:00-08:00)도 지원. */
export function isWithinBulkWindow(window: string, now: Date): boolean {
  const trimmed = window.trim();
  if (!trimmed) return true;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(trimmed);
  if (!m) return true;
  const [, sh, sm, eh, em] = m;
  const kst = new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000);
  const nowMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const startMinutes = Number(sh) * 60 + Number(sm);
  const endMinutes = Number(eh) * 60 + Number(em);
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
