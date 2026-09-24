import type { ConfigService } from '@nestjs/config';
import type { StatsGranularity } from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import {
  InvalidGranularityError,
  InvalidPeriodError as StatsInvalidPeriodError,
  ResolvedStatsPeriod,
  StatsRangeLimits,
  StatsRangeTooWideError,
  parseGranularity,
  resolveStatsPeriod,
} from './lib/stats-period';

/**
 * No.14/No.29 공용 요청 헬퍼(FR-0-89, `integrated-stats-설계.md` §2.5). `stats.service.ts:407-430·
 * 443-462`에서 이동했다 — 동작은 한 글자도 바꾸지 않는다. `StatsService`·`IntegratedStatsService`·
 * `IntentStatsService` 3곳이 공유한다. `ApiException`을 던지므로 `lib/`(DB·Nest 무의존)가 아니라
 * 이 위치에 둔다.
 */

/** 집계 전체 타임아웃(EX-2-5). 초과 시 캐시된 과거 결과를 대신 반환하지 않는다(FR-I7-3). */
export const AGGREGATION_TIMEOUT_MS = 5000;

export function parseGranularityOrThrow(raw: string | undefined): StatsGranularity {
  try {
    return parseGranularity(raw);
  } catch (e) {
    if (e instanceof InvalidGranularityError) {
      throw new ApiException('INVALID_GRANULARITY', 400, e.message);
    }
    throw e;
  }
}

export function resolveStatsPeriodOrThrow(
  from: Date | undefined,
  to: Date | undefined,
  granularity: StatsGranularity,
  limits: StatsRangeLimits,
): ResolvedStatsPeriod {
  try {
    return resolveStatsPeriod({ from, to, granularity, now: new Date(), limits });
  } catch (e) {
    if (e instanceof StatsInvalidPeriodError) {
      throw new ApiException('INVALID_PERIOD', 400, e.message);
    }
    if (e instanceof StatsRangeTooWideError) {
      throw new ApiException('STATS_RANGE_TOO_WIDE', 400, e.message);
    }
    throw e;
  }
}

/** 기간·단위 상한(FR-14-7/8/23) 환경변수 읽기 — 3개 서비스 공용(신규 환경변수 0개, §18 A-18). */
export function readStatsRangeLimits(config: ConfigService): StatsRangeLimits {
  return {
    maxRangeDays: config.get<number>('STATS_MAX_RANGE_DAYS') ?? 92,
    maxRangeWeeks: config.get<number>('STATS_MAX_RANGE_WEEKS') ?? 53,
    maxRangeMonths: config.get<number>('STATS_MAX_RANGE_MONTHS') ?? 24,
    defaultDays: 30,
    defaultWeeks: 12,
    defaultMonths: 12,
  };
}

export async function runWithAggregationTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('AGGREGATION_TIMEOUT')), AGGREGATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (e) {
    if (e instanceof Error && e.message === 'AGGREGATION_TIMEOUT') {
      throw new ApiException('AGGREGATION_TIMEOUT', 503, '지금은 통계를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer!);
  }
}
