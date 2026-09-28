import { apiClient } from './client';
import type {
  KbApproveIngestDto,
  KbDocumentListResponse,
  KbMetaResponse,
  KbRunCreateDto,
  KbRunListResponse,
  KbRunView,
  KbSourceCreateDto,
  KbSourceListResponse,
  KbSourceResponse,
  KbSourceUpdateDto,
} from '@chat-bot/shared-types';

/** 목록 공통 쿼리를 querystring으로 직렬화한다(`workflowRunsApi`의 `buildQuery` 선례). */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
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

export interface KbDocumentListParams {
  state?: string[];
  cleanupOnly?: boolean;
  runId?: string;
  observedChange?: string[];
  excludeReason?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * [신규 No.43] 지식베이스 자동 크롤링/동기화 관리 API(`kb-crawling-설계.md` §11) — `security:read`/
 * `security:write`. `KB_SYNC_ENABLED=false`면 전부 404(`meta`도 포함, KB12).
 */
export const kbSourcesApi = {
  meta: () => apiClient.get<KbMetaResponse>('/kb-sources/meta'),
  list: (page = 1, pageSize = 50) => apiClient.get<KbSourceListResponse>(`/kb-sources${buildQuery({ page, pageSize })}`),
  findOne: (id: string) => apiClient.get<KbSourceResponse>(`/kb-sources/${id}`),
  create: (dto: KbSourceCreateDto) => apiClient.post<KbSourceResponse>('/kb-sources', dto),
  update: (id: string, dto: KbSourceUpdateDto) => apiClient.patch<KbSourceResponse>(`/kb-sources/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/kb-sources/${id}`),
  createRun: (id: string, dto: KbRunCreateDto) => apiClient.post<{ runId: string }>(`/kb-sources/${id}/runs`, dto),
  approveIngest: (id: string, dto: KbApproveIngestDto) => apiClient.post<{ runId: string }>(`/kb-sources/${id}/approve-ingest`, dto),
  cancelRun: (id: string, runId: string) => apiClient.post<{ ok: true }>(`/kb-sources/${id}/runs/${runId}/cancel`),
  listRuns: (id: string, page = 1, pageSize = 50) => apiClient.get<KbRunListResponse>(`/kb-sources/${id}/runs${buildQuery({ page, pageSize })}`),
  getRun: (id: string, runId: string) => apiClient.get<KbRunView>(`/kb-sources/${id}/runs/${runId}`),
  listDocuments: (id: string, params: KbDocumentListParams) =>
    apiClient.get<KbDocumentListResponse>(
      `/kb-sources/${id}/documents${buildQuery({ page: params.page ?? 1, pageSize: params.pageSize ?? 50, state: params.state, cleanupOnly: params.cleanupOnly, runId: params.runId, observedChange: params.observedChange, excludeReason: params.excludeReason })}`,
    ),
};
