import { API_BASE_URL, apiClient } from './client';
import type { AuditChainVerifyRequestDto, AuditChainVerifyResponse, AuditLogDetail, AuditLogListQuery, AuditLogListResponse } from '@chat-bot/shared-types';

export interface AuditLogListParams {
  from?: string;
  to?: string;
  actorId?: string;
  action?: AuditLogListQuery['action'];
  targetType?: AuditLogListQuery['targetType'];
  chatbotId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

function buildQuery(params: AuditLogListParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.actorId) qs.set('actorId', params.actorId);
  if (params.action && params.action.length > 0) qs.set('action', params.action.join(','));
  if (params.targetType && params.targetType.length > 0) qs.set('targetType', params.targetType.join(','));
  if (params.chatbotId) qs.set('chatbotId', params.chatbotId);
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return qs;
}

/** 이력(감사로그) 조회(No.13, A1). 쓰기·삭제 경로가 없다(append-only, FR-13-14/20). */
export const auditLogsApi = {
  list: (params: AuditLogListParams) => apiClient.get<AuditLogListResponse>(`/audit-logs?${buildQuery(params).toString()}`),
  findOne: (id: string) => apiClient.get<AuditLogDetail>(`/audit-logs/${id}`),
  /**
   * CSV 내보내기(P2, FR-13-19)는 브라우저 기본 다운로드 내비게이션으로 처리한다 —
   * 동일 출처(`/api/v1` 프록시)라 쿠키가 자동으로 실리며 별도 fetch/blob 처리가 필요 없다.
   */
  exportUrl: (params: AuditLogListParams): string => `${API_BASE_URL}/audit-logs/export?${buildQuery(params).toString()}`,
  /** [신규 No.45] 감사 해시 체인 무결성 검증(`audit:read`, data-governance-ui-spec.md §3.5). */
  verify: (dto: AuditChainVerifyRequestDto) => apiClient.post<AuditChainVerifyResponse>('/audit-logs/verify', dto),
};
