import type { ChannelType, StatsGranularity, SurveyStatsGranularity, SurveyStatsSummary } from '@chat-bot/shared-types';
import { SURVEY_LIMITS } from '@chat-bot/shared-types';
import type { BucketKey } from '../../lib/bucket';
import { dayBucketToBucketKey } from '../../lib/bucket';

/** `SurveyStatsGranularity`(소문자, 위젯 비유입 쿼리 규약)를 통계 공용 `StatsGranularity`(대문자)로 변환한다. */
export function toStatsGranularity(g: SurveyStatsGranularity): StatsGranularity {
  return g.toUpperCase() as StatsGranularity;
}

export interface SurveyStatusCountRow {
  dayBucket: string;
  status: string;
  started: boolean;
  isDuplicate: boolean;
  count: number;
}

/** Q2 — `status ∈ {EXPOSED, IN_PROGRESS} ∧ lastInteractedAt ≥ cutoff`(= active)로 이미 필터된 행. */
export interface SurveyActiveCountRow {
  dayBucket: string;
  started: boolean;
  isDuplicate: boolean;
  count: number;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

const OPEN_STATUSES = new Set(['EXPOSED', 'IN_PROGRESS']);

/**
 * 참여 통계 요약 조립(§9.1·§9.2, 순수 함수) — `stats/lib/summary-assembler.ts`(No.14)는 수정하지
 * 않는다(FR-0-113). Q1(상태별)·Q2(활성)를 버킷·`includeDuplicates`에 맞춰 접는다.
 */
export function assembleSurveySummary(params: {
  buckets: BucketKey[];
  granularity: SurveyStatsGranularity;
  statusRows: readonly SurveyStatusCountRow[];
  activeRows: readonly SurveyActiveCountRow[];
  includeDuplicates: boolean;
  surveyId: string;
  from: string;
  to: string;
  generatedAt: Date;
  filters: { channel?: ChannelType };
}): SurveyStatsSummary {
  const useRow = (isDuplicate: boolean) => params.includeDuplicates || !isDuplicate;

  let exposed = 0;
  let started = 0;
  let completed = 0;
  let duplicates = 0;
  let abandoned = 0;
  let abandonedStarted = 0;
  let open = 0;
  let openStarted = 0;
  const bucketMap = new Map<string, { exposed: number; started: number; completed: number }>();
  for (const b of params.buckets) bucketMap.set(b.key, { exposed: 0, started: 0, completed: 0 });

  for (const row of params.statusRows) {
    if (row.isDuplicate) duplicates += row.count;
    if (!useRow(row.isDuplicate)) continue;

    exposed += row.count;
    if (row.started) started += row.count;
    if (row.status === 'COMPLETED') completed += row.count;
    if (row.status === 'ABANDONED') {
      abandoned += row.count;
      if (row.started) abandonedStarted += row.count;
    }
    if (OPEN_STATUSES.has(row.status)) {
      open += row.count;
      if (row.started) openStarted += row.count;
    }

    const bucketKey = dayBucketToBucketKey(row.dayBucket, toStatsGranularity(params.granularity));
    const bucket = bucketMap.get(bucketKey);
    if (bucket) {
      bucket.exposed += row.count;
      if (row.started) bucket.started += row.count;
      if (row.status === 'COMPLETED') bucket.completed += row.count;
    }
  }

  let active = 0;
  let activeStarted = 0;
  for (const row of params.activeRows) {
    if (!useRow(row.isDuplicate)) continue;
    active += row.count;
    if (row.started) activeStarted += row.count;
  }

  const droppedAfterStart = abandonedStarted + Math.max(0, openStarted - activeStarted);
  const droppedBeforeStart = abandoned - abandonedStarted + Math.max(0, open - openStarted - (active - activeStarted));

  const totals = {
    exposed,
    started,
    completed,
    inProgress: active,
    inProgressStarted: activeStarted,
    droppedAfterStart,
    droppedBeforeStart,
    duplicates,
    participationRate: ratio(started, exposed),
    completionRate: ratio(completed, exposed - active),
    dropoutRate: ratio(droppedAfterStart, started - activeStarted),
  };

  const buckets = params.buckets.map((b) => ({ key: b.key, label: b.label, ...bucketMap.get(b.key)! }));

  return {
    surveyId: params.surveyId,
    period: { from: params.from, to: params.to, granularity: params.granularity },
    generatedAt: params.generatedAt,
    timezone: 'Asia/Seoul',
    filters: params.filters,
    totals,
    buckets,
    lowSample: exposed < SURVEY_LIMITS.lowSampleThreshold,
  };
}
