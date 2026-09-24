import { apiClient } from './client';
import type {
  IntegratedBreakdown,
  IntegratedDistribution,
  IntegratedGroupOptions,
  IntegratedOverview,
  IntegratedQuestions,
  IntegratedSummary,
  StatsGranularity,
  StatsScope,
} from '@chat-bot/shared-types';

/** No.29 통합 통계(그룹/전역 스코프) 공통 쿼리(`integrated-stats-설계.md` §8). */
export interface IntegratedScopeParams {
  scope: StatsScope;
  groupId?: string;
}

export interface IntegratedStatsQueryParams extends IntegratedScopeParams {
  from?: string;
  to?: string;
  granularity?: StatsGranularity;
}

export interface IntegratedDistributionQueryParams extends IntegratedScopeParams {
  from?: string;
  to?: string;
}

/**
 * `/stats/integrated/breakdown`은 `IntegratedBreakdownQuerySchema`(=`IntegratedDistributionQuerySchema`
 * 별칭, `granularity` 없음) 계약이다(코드리뷰 L-2) — 요청 빌더 타입도 동일 모양을 그대로 공유한다.
 * (참고: shared-types의 `IntegratedBreakdownQuery`는 서버 파싱 후 `from`/`to`가 `Date`로 강제되는
 * *응답측* 타입이라 문자열 쿼리를 만드는 이 요청 빌더에는 그대로 쓸 수 없다 — 기존 `StatsQueryParams`와
 * 동일한 관례.)
 */
export type IntegratedBreakdownQueryParams = IntegratedDistributionQueryParams;

export interface IntegratedQuestionsQueryParams extends IntegratedScopeParams {
  from?: string;
  to?: string;
  topN?: number;
  includeArchivedChatbots?: boolean;
}

function buildQuery(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

export const integratedStatsApi = {
  getOverview: (params: IntegratedScopeParams) => apiClient.get<IntegratedOverview>(`/stats/integrated/overview?${buildQuery(params)}`),
  getSummary: (params: IntegratedStatsQueryParams) => apiClient.get<IntegratedSummary>(`/stats/integrated/summary?${buildQuery(params)}`),
  getDistribution: (params: IntegratedDistributionQueryParams) =>
    apiClient.get<IntegratedDistribution>(`/stats/integrated/distribution?${buildQuery(params)}`),
  getBreakdown: (params: IntegratedBreakdownQueryParams) => apiClient.get<IntegratedBreakdown>(`/stats/integrated/breakdown?${buildQuery(params)}`),
  getQuestions: (params: IntegratedQuestionsQueryParams) =>
    apiClient.get<IntegratedQuestions>(`/stats/integrated/questions?${buildQuery(params)}`),
  getGroupOptions: () => apiClient.get<IntegratedGroupOptions>('/stats/integrated/groups'),
};
