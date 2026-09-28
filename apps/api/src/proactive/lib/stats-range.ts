import { KST_OFFSET_MINUTES, PROACTIVE_LIMITS, toKstDayBucket } from '@chat-bot/shared-types';

/**
 * [신규 No.35] 통계 조회 기간(`from`~`to`, KST `YYYY-MM-DD`) 결정 — 기본 최근 7일 · 최대 90일(§11).
 * 순수 — DB·Nest 무의존(시각은 인자).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function dayBucketToUtcMs(dayBucket: string): number {
  const [y, m, d] = dayBucket.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1) - KST_OFFSET_MINUTES * 60 * 1000;
}

export function resolveProactiveStatsRange(rawFrom: string | undefined, rawTo: string | undefined, now: Date): { from: string; to: string } {
  const todayBucket = toKstDayBucket(now);
  const requestedTo = rawTo ?? todayBucket;
  const to = requestedTo > todayBucket ? todayBucket : requestedTo;

  const requestedFrom = rawFrom ?? toKstDayBucket(new Date(now.getTime() - (PROACTIVE_LIMITS.statsRangeDaysDefault - 1) * DAY_MS));
  const maxSpanMs = (PROACTIVE_LIMITS.statsRangeDaysMax - 1) * DAY_MS;
  const minFromMs = dayBucketToUtcMs(to) - maxSpanMs;
  const from = dayBucketToUtcMs(requestedFrom) < minFromMs ? toKstDayBucket(new Date(minFromMs)) : requestedFrom;

  return from > to ? { from: to, to } : { from, to };
}
