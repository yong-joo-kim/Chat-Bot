import { apiClient } from './client';
import type { DashboardSummary, FeedbackStats, IntentStats, StatsDistribution, StatsGranularity, StatsQuestions, StatsSummary } from '@chat-bot/shared-types';

/** [신규 No.44] `GET /stats/feedback` 쿼리(chatbotId/from/to/topN). */
export interface FeedbackStatsQueryParams {
  chatbotId: string;
  from?: string;
  to?: string;
  topN?: number;
}

export interface DashboardQueryParams {
  chatbotId: string;
  from?: string;
  to?: string;
  topN?: number;
}

/** No.14 기본 통계 3종 공통 쿼리(FR-14-4~12). `granularity` 미지정 시 서버 기본값(`DAY`)이 적용된다. */
export interface StatsQueryParams {
  chatbotId: string;
  from?: string;
  to?: string;
  granularity?: StatsGranularity;
}

export interface StatsQuestionsQueryParams extends StatsQueryParams {
  topN?: number;
}

function buildStatsQuery(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  return qs.toString();
}

export const statsApi = {
  getDashboard: (params: DashboardQueryParams) => {
    const qs = new URLSearchParams();
    qs.set('chatbotId', params.chatbotId);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.topN) qs.set('topN', String(params.topN));
    return apiClient.get<DashboardSummary>(`/stats/dashboard?${qs.toString()}`);
  },
  /** J-4 — 기간 시계열(FR-14-4~19). `개발명세서.md` §4/DD-49 갱신분 경로. */
  getSummary: (params: StatsQueryParams) => apiClient.get<StatsSummary>(`/stats/summary?${buildStatsQuery(params)}`),
  /** 응답 출처/채널/시간대/요일 분포(FR-14-20~30). */
  getDistribution: (params: StatsQueryParams) => apiClient.get<StatsDistribution>(`/stats/distribution?${buildStatsQuery(params)}`),
  /** 인기질문·미응답질문 TOP N(FR-14-23~27). */
  getQuestions: (params: StatsQuestionsQueryParams) => apiClient.get<StatsQuestions>(`/stats/questions?${buildStatsQuery(params)}`),
  /** [신규 No.29] 챗봇 스코프 의도별 매칭(J-13, `integrated-stats-ui-spec.md` §4). */
  getIntentStats: (params: StatsQuestionsQueryParams) => apiClient.get<IntentStats>(`/stats/intents?${buildStatsQuery(params)}`),
  /** [신규 No.44] 답변 만족도(FB-S1) — S1과 독립적으로 호출된다(feedback-loop-ui-spec.md §3.4). */
  getFeedbackStats: (params: FeedbackStatsQueryParams) => apiClient.get<FeedbackStats>(`/stats/feedback?${buildStatsQuery(params)}`),
};
