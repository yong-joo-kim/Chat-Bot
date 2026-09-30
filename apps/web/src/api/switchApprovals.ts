import { apiClient } from './client';
import type {
  ApprovalPolicyStatus,
  ApprovalSummaryResponse,
  ApproveProdSwitchDto,
  ApproveProdSwitchResponse,
  CreateProdSwitchApprovalDto,
  Paginated,
  ProdSwitchApprovalDetail,
  ProdSwitchApprovalSummary,
  RejectProdSwitchDto,
  UpdateApprovalPolicyDto,
} from '@chat-bot/shared-types';

const base = (chatbotId: string): string => `/chatbots/${chatbotId}/environment/approval`;

/**
 * 운영 전환 2인 승인(No.36) API — 챗봇 스코프 7 + 전역 2 핸들러(`ai-guardrails-ui-spec.md` §13.1).
 * 조회는 `chatbot:read`+`dialogue:read`, 나머지는 `chatbot:deploy`.
 */
export const switchApprovalsApi = {
  getStatus: (chatbotId: string) => apiClient.get<ApprovalPolicyStatus>(base(chatbotId)),
  updatePolicy: (chatbotId: string, dto: UpdateApprovalPolicyDto) => apiClient.put<ApprovalPolicyStatus>(base(chatbotId), dto),
  createRequest: (chatbotId: string, dto: CreateProdSwitchApprovalDto) => apiClient.post<ProdSwitchApprovalSummary>(`${base(chatbotId)}/requests`, dto),
  getRequest: (chatbotId: string, requestId: string) => apiClient.get<ProdSwitchApprovalDetail>(`${base(chatbotId)}/requests/${requestId}`),
  approve: (chatbotId: string, requestId: string, dto: ApproveProdSwitchDto) =>
    apiClient.post<ApproveProdSwitchResponse>(`${base(chatbotId)}/requests/${requestId}/approve`, dto),
  reject: (chatbotId: string, requestId: string, dto: RejectProdSwitchDto) =>
    apiClient.post<ProdSwitchApprovalSummary>(`${base(chatbotId)}/requests/${requestId}/reject`, dto),
  cancel: (chatbotId: string, requestId: string) => apiClient.post<ProdSwitchApprovalSummary>(`${base(chatbotId)}/requests/${requestId}/cancel`),
  listGlobal: (query: { status?: 'PENDING' | 'ALL'; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (query.status) qs.set('status', query.status);
    if (query.page) qs.set('page', String(query.page));
    if (query.pageSize) qs.set('pageSize', String(query.pageSize));
    const s = qs.toString();
    return apiClient.get<Paginated<ProdSwitchApprovalSummary>>(`/environment-approvals${s ? `?${s}` : ''}`);
  },
  summary: () => apiClient.get<ApprovalSummaryResponse>('/environment-approvals/summary'),
};
