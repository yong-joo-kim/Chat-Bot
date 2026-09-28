import { KST_OFFSET_MINUTES } from '@chat-bot/shared-types';
import type { KbSchedule } from '@chat-bot/shared-types';

/**
 * [신규 No.43] 다음 실행 시각 계산(순수 · KST — §9.2). 서버가 여러 회차를 놓쳤어도 **1회만** 따라잡는다
 * (미래의 가장 가까운 발생 시각 하나만 반환 — misfire 누적 실행 없음).
 */
const DAY_MS = 86_400_000;

function toKst(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * 60_000);
}
function fromKst(kstDate: Date): Date {
  return new Date(kstDate.getTime() - KST_OFFSET_MINUTES * 60_000);
}

export function computeNextRunAt(schedule: KbSchedule, now: Date): Date | null {
  if (schedule.kind === 'MANUAL') return null;

  const [hh, mm] = schedule.time.split(':').map(Number);
  const nowKst = toKst(now);
  const todayCandidate = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate(), hh, mm, 0, 0));

  if (schedule.kind === 'DAILY') {
    let result = todayCandidate;
    if (result.getTime() <= nowKst.getTime()) result = new Date(result.getTime() + DAY_MS);
    return fromKst(result);
  }

  // WEEKLY — weekday: 0(일)~6(토), JS Date.getUTCDay()과 같은 규약.
  const currentWeekday = nowKst.getUTCDay();
  const daysAhead = (schedule.weekday - currentWeekday + 7) % 7;
  let result = new Date(todayCandidate.getTime() + daysAhead * DAY_MS);
  if (result.getTime() <= nowKst.getTime()) result = new Date(result.getTime() + 7 * DAY_MS);
  return fromKst(result);
}
