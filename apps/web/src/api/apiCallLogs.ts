import { apiClient } from './client';
import type { ApiCallLogItem, ApiCallLogListQuery, ApiCallLogSummary, Paginated } from '@chat-bot/shared-types';

/** 목록 공통 쿼리를 querystring으로 직렬화한다(`csvEnumArray` 필드는 콤마 구분). */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      qs.set(key, value.join(','));
      continue;
    }
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** [No.26] 외부 연동 로그(L1, `legacy-api-integration-ui-spec.md` §3.8) — `chatbot:read`(세 역할 전부). */
export const apiCallLogsApi = {
  list: (chatbotId: string, query: Partial<ApiCallLogListQuery>) =>
    apiClient.get<Paginated<ApiCallLogItem>>(`/chatbots/${chatbotId}/api-call-logs${buildQuery(query)}`),
  summary: (chatbotId: string, query: Partial<ApiCallLogListQuery>) =>
    apiClient.get<ApiCallLogSummary>(`/chatbots/${chatbotId}/api-call-logs/summary${buildQuery(query)}`),
};
