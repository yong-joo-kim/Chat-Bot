import { KST_OFFSET_MINUTES } from '@chat-bot/shared-types';

/**
 * ★ "HH:MM-HH:MM" KST 실행 창 판정 — 순수(No.45 §9.1). 자정 넘김(예: `22:00-02:00`)을 지원한다.
 */
export function parseWindow(window: string): { startMin: number; endMin: number } | null {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (startMin > 24 * 60 || endMin > 24 * 60) return null;
  return { startMin, endMin };
}

function kstMinuteOfDay(now: Date): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

export function isWithinKstWindow(now: Date, window: string): boolean {
  const parsed = parseWindow(window);
  if (!parsed) return false;
  const cur = kstMinuteOfDay(now);
  const { startMin, endMin } = parsed;
  if (startMin === endMin) return true; // 24시간 창(운영자가 명시한 경우)
  if (startMin < endMin) {
    return cur >= startMin && cur < endMin;
  }
  // 자정 넘김(예: 22:00-02:00)
  return cur >= startMin || cur < endMin;
}

/**
 * ★ [신규] "다음 창 시작" 시각(§8.4 영향 미리보기 · AC-DG5-* 표시용) — 순수. 이미 창 안이면
 * 다음 tick(5분 주기)에서 곧 실행되므로 `now`를 그대로 반환한다. 창 밖이면 오늘(아직 시작 전)
 * 또는 내일(이미 지남)의 시작 시각을 KST 기준으로 계산해 UTC `Date`로 반환한다.
 */
export function nextWindowStart(now: Date, window: string): Date {
  const parsed = parseWindow(window);
  if (!parsed) return new Date(now.getTime() + 86_400_000); // 형식 오류 — 안전 측 폴백(하루 뒤)
  if (isWithinKstWindow(now, window)) return now;

  const { startMin } = parsed;
  const kst = new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const curMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const startHour = Math.floor(startMin / 60);
  const startMinute = startMin % 60;
  const todayStartUtcMs = Date.UTC(y, m, d, startHour, startMinute) - KST_OFFSET_MINUTES * 60_000;

  return curMin < startMin ? new Date(todayStartUtcMs) : new Date(todayStartUtcMs + 86_400_000);
}
