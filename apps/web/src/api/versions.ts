import { apiClient } from './client';
import type {
  ChatbotVersionDetail,
  ChatbotVersionListItem,
  ChatbotVersionListQuery,
  CreateChatbotVersionDto,
  CreateChatbotVersionResponse,
  Paginated,
  RestorePreviewResponse,
  RestoreRequestDto,
  RestoreResponse,
  UpdateChatbotVersionDto,
  VersionAssetKind,
  VersionAuditCount,
  VersionContentPage,
  VersionContentQuery,
  VersionCurrentStatus,
  VersionDiffItemDetail,
  VersionDiffQuery,
  VersionDiffResponse,
} from '@chat-bot/shared-types';

/**
 * No.25 챗봇 복원/버전 이력관리 API 클라이언트. 실제 라우트는
 * `apps/api/src/versions/versions.controller.ts`(코드 확인) — 12개 핸들러.
 */
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

export const versionsApi = {
  list: (chatbotId: string, query: Partial<ChatbotVersionListQuery> = {}) =>
    apiClient.get<Paginated<ChatbotVersionListItem>>(`/chatbots/${chatbotId}/versions${buildQuery(query)}`),
  current: (chatbotId: string) => apiClient.get<VersionCurrentStatus>(`/chatbots/${chatbotId}/versions/current`),
  create: (chatbotId: string, dto: CreateChatbotVersionDto) =>
    apiClient.post<CreateChatbotVersionResponse>(`/chatbots/${chatbotId}/versions`, dto),
  detail: (chatbotId: string, versionId: string) =>
    apiClient.get<ChatbotVersionDetail>(`/chatbots/${chatbotId}/versions/${versionId}`),
  content: (chatbotId: string, versionId: string, query: Partial<VersionContentQuery>) =>
    apiClient.get<VersionContentPage>(`/chatbots/${chatbotId}/versions/${versionId}/content${buildQuery(query)}`),
  update: (chatbotId: string, versionId: string, dto: UpdateChatbotVersionDto) =>
    apiClient.patch<ChatbotVersionDetail>(`/chatbots/${chatbotId}/versions/${versionId}`, dto),
  remove: (chatbotId: string, versionId: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/versions/${versionId}`),
  diff: (chatbotId: string, versionId: string, query: Partial<VersionDiffQuery> & { against: string }) =>
    apiClient.get<VersionDiffResponse>(`/chatbots/${chatbotId}/versions/${versionId}/diff${buildQuery(query)}`),
  diffItemDetail: (chatbotId: string, versionId: string, kind: VersionAssetKind, itemId: string, against: string) =>
    apiClient.get<VersionDiffItemDetail>(
      `/chatbots/${chatbotId}/versions/${versionId}/diff/items/${kind}/${itemId}${buildQuery({ against })}`,
    ),
  auditCount: (chatbotId: string, versionId: string) =>
    apiClient.get<VersionAuditCount>(`/chatbots/${chatbotId}/versions/${versionId}/audit-count`),
  restorePreview: (chatbotId: string, versionId: string) =>
    apiClient.post<RestorePreviewResponse>(`/chatbots/${chatbotId}/versions/${versionId}/restore/preview`, undefined),
  restore: (chatbotId: string, versionId: string, dto: RestoreRequestDto) =>
    apiClient.post<RestoreResponse>(`/chatbots/${chatbotId}/versions/${versionId}/restore`, dto),
};
