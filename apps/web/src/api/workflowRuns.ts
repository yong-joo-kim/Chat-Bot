import { apiClient } from './client';
import type { WorkflowRunListQuery, WorkflowRunListResponse, WorkflowSummaryResponse } from '@chat-bot/shared-types';

/** 목록 공통 쿼리를 querystring으로 직렬화한다(`csvEnumArray` 필드는 콤마 구분, `apiCallLogsApi` 선례). */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      qs.set(key, value.join(','));
      continue;
    }
    if (value instanceof Date) {
      qs.set(key, value.toISOString());
      continue;
    }
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * [No.41] 실행 이력(전역, `workflow-automation-ui-spec.md` §3.2) — `security:read`.
 * 재발송은 챗봇 스코프 전용(§3.2b)이라 이 클라이언트에는 없다.
 */
export const workflowRunsApi = {
  list: (query: Partial<WorkflowRunListQuery>) => apiClient.get<WorkflowRunListResponse>(`/workflow-runs${buildQuery(query)}`),
  summary: (days: 7 | 30) => apiClient.get<WorkflowSummaryResponse>(`/workflow-runs/summary${buildQuery({ days })}`),
};

export { buildQuery as buildWorkflowRunQuery };
