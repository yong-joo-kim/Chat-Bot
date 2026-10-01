import { KST_OFFSET_MINUTES, SPEECH_LIMITS, toKstDayBucket } from '@chat-bot/shared-types';
import type { VoiceStatsResponse } from '@chat-bot/shared-types';

/**
 * [신규 No.32] 인식 숫자 조회 기간(KST `YYYY-MM-DD`) 결정 — 기본 최근 7일 · 최대 90일, 0인 날도 채운다(voice-ai-설계.md §4.1).
 * 순수 — DB·Nest 무의존(시각은 인자). 선제 안내 통계(`proactive/lib/stats-range.ts`)와 같은 규칙에 음성 한도를 쓴다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function dayBucketToUtcMs(dayBucket: string): number {
  const [y, m, d] = dayBucket.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1) - KST_OFFSET_MINUTES * 60 * 1000;
}

export function resolveVoiceStatsRange(rawFrom: string | undefined, rawTo: string | undefined, now: Date): { from: string; to: string } {
  const todayBucket = toKstDayBucket(now);
  const requestedTo = rawTo ?? todayBucket;
  const to = requestedTo > todayBucket ? todayBucket : requestedTo;

  const requestedFrom = rawFrom ?? toKstDayBucket(new Date(now.getTime() - (SPEECH_LIMITS.statsRangeDaysDefault - 1) * DAY_MS));
  const maxSpanMs = (SPEECH_LIMITS.statsRangeDaysMax - 1) * DAY_MS;
  const minFromMs = dayBucketToUtcMs(to) - maxSpanMs;
  const from = dayBucketToUtcMs(requestedFrom) < minFromMs ? toKstDayBucket(new Date(minFromMs)) : requestedFrom;

  return from > to ? { from: to, to } : { from, to };
}

export interface SpeechStatRow {
  dayBucket: string;
  ok: number;
  empty: number;
  invalid: number;
  failed: number;
  busy: number;
}

type Counts = VoiceStatsResponse['totals'];

function zero(): Counts {
  return { requested: 0, ok: 0, empty: 0, invalid: 0, failed: 0, busy: 0 };
}

/** 요청 수 = 다섯 칸의 합(저장하지 않는다). 기간의 모든 날을 채워 돌려준다. */
export function aggregateVoiceStats(rows: readonly SpeechStatRow[], from: string, to: string): Pick<VoiceStatsResponse, 'totals' | 'daily'> {
  const byDay = new Map(rows.map((r) => [r.dayBucket, r] as const));
  const totals = zero();
  const daily: VoiceStatsResponse['daily'] = [];
  const start = dayBucketToUtcMs(from);
  const end = dayBucketToUtcMs(to);
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const day = toKstDayBucket(new Date(ms));
    const r = byDay.get(day);
    const counts: Counts = r
      ? { requested: r.ok + r.empty + r.invalid + r.failed + r.busy, ok: r.ok, empty: r.empty, invalid: r.invalid, failed: r.failed, busy: r.busy }
      : zero();
    daily.push({ day, ...counts });
    totals.requested += counts.requested;
    totals.ok += counts.ok;
    totals.empty += counts.empty;
    totals.invalid += counts.invalid;
    totals.failed += counts.failed;
    totals.busy += counts.busy;
  }
  return { totals, daily };
}
