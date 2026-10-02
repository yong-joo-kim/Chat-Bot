import { formatInstantInZone, zonedLocalToInstant } from '@chat-bot/shared-types';

/** "KST, UTC+9" 형태의 시간대 라벨(NFR-DA1 — 모든 시각에 항상 병기). */
export function timezoneLabel(timezone: string): string {
  const f = formatInstantInZone(new Date(), timezone);
  return f.abbreviation ? `${f.abbreviation}, ${f.offsetLabel}` : f.offsetLabel;
}

/**
 * [DHX-5] API 응답의 시각은 JSON 문자열(ISO)로 오지만 공유 타입은 `Date`로 선언돼 있어(웹 `apiClient`는 날짜를 복원하지 않는다)
 * 문자열이 그대로 들어오면 `Invalid time value`로 화면이 비었다 — 문자열·`Date` 모두 받아 순간으로 정규화한다.
 */
export function toInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatInZone(instant: Date | string, timezone: string): string {
  const f = formatInstantInZone(toInstant(instant), timezone);
  return `${f.date} ${f.time}`;
}

/**
 * No.28 M-1 — 예약 화면 전역에서 쓰는 "시각 + 시간대 라벨" 조합 표시(NFR-DA1, UIUX §1 — 화면의
 * 모든 시각에 시간대를 항상 병기). `lib/date.ts#formatDateTime`(하드코딩 Asia/Seoul)을 대신한다.
 */
export function formatScheduleDateTime(instant: Date | string, timezone: string): string {
  return `${formatInZone(instant, timezone)} (${timezoneLabel(timezone)})`;
}

/** "2027-11-01 00:00" → 지정 시간대 순간(§14). 모호/존재하지 않는 로컬시각은 null. */
export function localPartsToInstant(date: string, hour: string, minute: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const result = zonedLocalToInstant({ date, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }, timezone);
  if (result.kind === 'OK') return result.instant;
  if (result.kind === 'AMBIGUOUS') return result.earlier;
  return null;
}

/** "지금으로부터 {n}일 {n}시간 후" 보조문(FR-D7-3). */
export function relativeFutureText(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return '0분';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (days === 0 && hours === 0) parts.push(`${minutes}분`);
  return parts.join(' ');
}

/** 지금 시각을 5분 단위 미래로 올림한 기본 예약 시각 후보(리드타임 위반을 기본값에서부터 피한다). */
export function defaultScheduledAt(now: Date, minLeadMinutes: number): Date {
  const d = new Date(now.getTime() + (minLeadMinutes + 1) * 60_000);
  d.setSeconds(0, 0);
  return d;
}
