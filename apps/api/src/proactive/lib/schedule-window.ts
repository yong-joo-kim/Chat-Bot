import { KST_OFFSET_MINUTES, toKstDayBucket, toKstWeekday } from '@chat-bot/shared-types';
import type { ProactivePeriodState, ProactiveSchedule } from '@chat-bot/shared-types';

/**
 * [신규 No.35] 게시 기간·표시 시간대(KST) 판정 · `showUntil` 계산. 순수 — DB·Nest 무의존(시각은
 * 인자, §16.2 "시각은 상대값" 시험 원칙).
 */

export function computePeriodState(startsAt: Date | null, endsAt: Date | null, now: Date): ProactivePeriodState {
  if (!startsAt && !endsAt) return 'ALWAYS';
  if (endsAt && now.getTime() >= endsAt.getTime()) return 'ENDED';
  if (startsAt && now.getTime() < startsAt.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}

export function isWithinPublishPeriod(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && now.getTime() < startsAt.getTime()) return false;
  if (endsAt && now.getTime() >= endsAt.getTime()) return false;
  return true;
}

function parseHHmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** KST 자정 기준 경과 분(0~1439). */
function kstMinutesSinceMidnight(now: Date): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** KST '오늘' 자정(00:00) 시각을 UTC epoch ms로. */
function kstMidnightUtcMs(now: Date): number {
  return now.getTime() - kstMinutesSinceMidnight(now) * 60 * 1000;
}

/** 표시 시간대(선택) — 요일 체계는 `toKstWeekday()`(0=월~6=일). 자정 넘김 불허(1차, R-14). */
export function isWithinScheduleWindow(schedule: ProactiveSchedule | null, now: Date): boolean {
  if (!schedule) return true;
  const weekday = toKstWeekday(toKstDayBucket(now));
  if (!schedule.days.includes(weekday)) return false;
  const nowMin = kstMinutesSinceMidnight(now);
  return nowMin >= parseHHmmToMinutes(schedule.from) && nowMin < parseHHmmToMinutes(schedule.to);
}

/** 오늘(KST) 표시 시간대 종료 시각(UTC epoch ms) — 오늘이 `schedule.days`에 없으면 `undefined`. */
function kstScheduleEndTodayMs(schedule: ProactiveSchedule, now: Date): number | undefined {
  const weekday = toKstWeekday(toKstDayBucket(now));
  if (!schedule.days.includes(weekday)) return undefined;
  return kstMidnightUtcMs(now) + parseHHmmToMinutes(schedule.to) * 60 * 1000;
}

/** `showUntil = min(endsAt, 오늘 KST 표시 시간대 종료 시각)` — 둘 다 없으면 `undefined`(§5.2 ⑦). */
export function computeShowUntil(endsAt: Date | null, schedule: ProactiveSchedule | null, now: Date): Date | undefined {
  const candidates: number[] = [];
  if (endsAt) candidates.push(endsAt.getTime());
  if (schedule) {
    const todayEnd = kstScheduleEndTodayMs(schedule, now);
    if (todayEnd !== undefined) candidates.push(todayEnd);
  }
  if (candidates.length === 0) return undefined;
  return new Date(Math.min(...candidates));
}
