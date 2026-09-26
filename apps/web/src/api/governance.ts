import { apiClient } from './client';
import type {
  ChatbotRetentionUpdateDto,
  GlobalRetentionUpdateDto,
  GovernanceMapResponse,
  Paginated,
  PaginationQuery,
  RetentionOverrideListResponse,
  RetentionPolicyResponse,
  RetentionPreviewRequestDto,
  RetentionPreviewResponse,
  RetentionRunItem,
  RetentionRunListQuery,
} from '@chat-bot/shared-types';

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
 * No.45 데이터 거버넌스(G1~G1-c) API 클라이언트(`data-governance-ui-spec.md` §11-4).
 */
export const governanceApi = {
  map: () => apiClient.get<GovernanceMapResponse>('/governance/map'),
  retention: {
    get: () => apiClient.get<RetentionPolicyResponse>('/governance/retention'),
    update: (dto: GlobalRetentionUpdateDto) => apiClient.put<RetentionPolicyResponse>('/governance/retention', dto),
    preview: (dto: RetentionPreviewRequestDto) => apiClient.post<RetentionPreviewResponse>('/governance/retention/preview', dto),
    cancelAllPending: () => apiClient.post<RetentionPolicyResponse>('/governance/retention/pending/cancel', undefined),
    /** [신규 2차] G1-b "챗봇별 재정의" 목록(`security:read`, 페이지네이션만 — 필터 없음). */
    overrides: (query: Partial<PaginationQuery> = {}) =>
      apiClient.get<RetentionOverrideListResponse>(`/governance/retention/overrides${buildQuery(query)}`),
  },
  retentionRuns: (query: Partial<RetentionRunListQuery> = {}) =>
    apiClient.get<Paginated<RetentionRunItem>>(`/governance/retention-runs${buildQuery(query)}`),
};

/**
 * [신규 2차] G2 — 챗봇별 보존기간 재정의(`/chatbots/:chatbotId/retention*`, `chatbot:read`+
 * `security:read|write` AND 조건 — `data-governance-ui-spec.md` §3.4).
 */
export const chatbotRetentionApi = {
  get: (chatbotId: string) => apiClient.get<RetentionPolicyResponse>(`/chatbots/${chatbotId}/retention`),
  update: (chatbotId: string, dto: ChatbotRetentionUpdateDto) =>
    apiClient.put<RetentionPolicyResponse>(`/chatbots/${chatbotId}/retention`, dto),
  preview: (chatbotId: string, dto: RetentionPreviewRequestDto) =>
    apiClient.post<RetentionPreviewResponse>(`/chatbots/${chatbotId}/retention/preview`, dto),
  cancelPending: (chatbotId: string) => apiClient.post<RetentionPolicyResponse>(`/chatbots/${chatbotId}/retention/pending/cancel`, undefined),
};
