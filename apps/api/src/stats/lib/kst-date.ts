/**
 * No.14 통계 그룹 내부에서만 쓰는 KST 달력 연산 헬퍼(FR-0-31, J-3).
 * ⚠ 공개 API가 아니다 — `apps/api` 밖(백필 스크립트·seed·`apps/web`)은
 * `@chat-bot/shared-types`의 `toKstDayBucket`/`toKstHourOfDay`/`toKstWeekday`를 쓴다.
 * 이 파일은 `stats-period.ts`/`bucket.ts`/`usage-trend.ts`가 공유하는 달력 산술(주/월 경계,
 * ISO 주차 번호)만 담당하며 DB·Nest 무의존 순수 함수다.
 */
export const KST_OFFSET_MINUTES = 540;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface KstDateOnly {
  y: number;
  m: number; // 0-based
  d: number;
}

export function toKstDateOnly(date: Date): KstDateOnly {
  const kst = new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth(), d: kst.getUTCDate() };
}

export function parseDayBucket(dayBucket: string): KstDateOnly {
  const [y, m, d] = dayBucket.split('-').map(Number);
  return { y, m: (m ?? 1) - 1, d: d ?? 1 };
}

export function formatDayBucket(kst: KstDateOnly): string {
  const mm = String(kst.m + 1).padStart(2, '0');
  const dd = String(kst.d).padStart(2, '0');
  return `${kst.y}-${mm}-${dd}`;
}

export function kstDateOnlyToUtc(kst: KstDateOnly, hh: number, mm: number, ss: number, ms: number): Date {
  const utcMs = Date.UTC(kst.y, kst.m, kst.d, hh, mm, ss, ms) - KST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

export function addDaysKst(kst: KstDateOnly, days: number): KstDateOnly {
  const utcMs = Date.UTC(kst.y, kst.m, kst.d) + days * MS_PER_DAY;
  const d = new Date(utcMs);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/** ISO 요일(0=월~6=일). 순수 달력 연산 — 서버 TZ와 무관하게 결정적이다. */
export function isoWeekday(kst: KstDateOnly): number {
  const jsDay = new Date(Date.UTC(kst.y, kst.m, kst.d)).getUTCDay(); // 0=일~6=토
  return (jsDay + 6) % 7;
}

export function mondayOf(kst: KstDateOnly): KstDateOnly {
  return addDaysKst(kst, -isoWeekday(kst));
}

export function addMonthsKst(kst: KstDateOnly, delta: number): KstDateOnly {
  const total = kst.y * 12 + kst.m + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return { y, m, d: 1 };
}

export function monthIndex(kst: KstDateOnly): number {
  return kst.y * 12 + kst.m;
}

/** ISO-8601 주차(목요일이 속한 연도 기준, FR-14-5). */
export function isoWeekInfo(kst: KstDateOnly): { isoYear: number; week: number } {
  const dayNr = isoWeekday(kst) + 1; // Mon=1..Sun=7
  const thursday = addDaysKst(kst, 4 - dayNr);
  const jan1 = { y: thursday.y, m: 0, d: 1 };
  const diffDays = Math.round((Date.UTC(thursday.y, thursday.m, thursday.d) - Date.UTC(jan1.y, jan1.m, jan1.d)) / MS_PER_DAY);
  const week = Math.floor(diffDays / 7) + 1;
  return { isoYear: thursday.y, week };
}

const WEEKDAY_LABELS_KO = ['월', '화', '수', '목', '금', '토', '일'];

export function formatMonthDayLabel(kst: KstDateOnly): string {
  const mm = String(kst.m + 1).padStart(2, '0');
  const dd = String(kst.d).padStart(2, '0');
  return `${mm}/${dd}(${WEEKDAY_LABELS_KO[isoWeekday(kst)]})`;
}
