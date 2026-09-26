import { apiClient } from './client';
import type {
  AssignThreadDto,
  ChatbotInboxIdentityUpdateDto,
  ChatbotInboxSettingsResponse,
  ChatbotInboxSettingsUpdateDto,
  CreateAnonymousCustomerDto,
  CreateAnonymousCustomerResponse,
  CreateNoteDto,
  CreateRecordDto,
  CreateTestCustomerDto,
  CreateTestCustomerResponse,
  CustomerSearchDto,
  CustomerSearchResponse,
  IdentitySpaceListResponse,
  InboxAssigneeListResponse,
  InboxMaskPreviewResponse,
  InboxSummaryResponse,
  InboxTagCreateDto,
  InboxTagItem,
  InboxTagListResponse,
  InboxTagUpdateDto,
  InboxThreadDetail,
  InboxThreadListItem,
  InboxThreadListQuery,
  InboxThreadListResponse,
  LinkSessionDto,
  MergeCustomerDto,
  MergeResult,
  OpenThreadFromSessionDto,
  OpenThreadFromSessionResponse,
  ReleaseThreadDto,
  RevertMergeResult,
  SessionLinkLookupResponse,
  SetThreadTagsDto,
  SimulateInboxDto,
  SimulateInboxResponse,
  UpdateNoteDto,
  UpdateThreadStateDto,
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
 * 옴니채널 통합 인박스(No.42) 관리자 API 클라이언트(`omnichannel-inbox-설계.md` §14.1 — 32 핸들러).
 * `OMNI_INBOX_ENABLED=false`이면 전부 404를 반환한다(`InboxEnabledGuard`, `ApiError.status===404`).
 */
export const inboxApi = {
  // 스레드(14) — `omnichannel-inbox-ui-spec.md` OI-1·OI-2·OI-3·OI-4
  threads: (query: Partial<InboxThreadListQuery> = {}) => apiClient.get<InboxThreadListResponse>(`/inbox/threads${buildQuery(query)}`),
  summary: () => apiClient.get<InboxSummaryResponse>('/inbox/threads/summary'),
  assignees: () => apiClient.get<InboxAssigneeListResponse>('/inbox/assignees'),
  openFromSession: (dto: OpenThreadFromSessionDto) => apiClient.post<OpenThreadFromSessionResponse>('/inbox/threads/open', dto),
  maskPreview: (text: string) => apiClient.post<InboxMaskPreviewResponse>('/inbox/mask-preview', { text }),
  threadDetail: (threadId: string, cursor?: string) =>
    apiClient.get<InboxThreadDetail>(`/inbox/threads/${threadId}${buildQuery({ cursor })}`),
  updateState: (threadId: string, dto: UpdateThreadStateDto) => apiClient.patch<InboxThreadListItem>(`/inbox/threads/${threadId}`, dto),
  claim: (threadId: string, version: number) => apiClient.post<InboxThreadListItem>(`/inbox/threads/${threadId}/claim`, { version }),
  assign: (threadId: string, dto: AssignThreadDto) => apiClient.post<InboxThreadListItem>(`/inbox/threads/${threadId}/assign`, dto),
  release: (threadId: string, dto: ReleaseThreadDto) => apiClient.post<InboxThreadListItem>(`/inbox/threads/${threadId}/release`, dto),
  setTags: (threadId: string, dto: SetThreadTagsDto) => apiClient.put<InboxThreadListItem>(`/inbox/threads/${threadId}/tags`, dto),
  createNote: (threadId: string, dto: CreateNoteDto) => apiClient.post<InboxThreadListItem>(`/inbox/threads/${threadId}/notes`, dto),
  updateNote: (threadId: string, entryId: string, dto: UpdateNoteDto) =>
    apiClient.patch<InboxThreadListItem>(`/inbox/threads/${threadId}/notes/${entryId}`, dto),
  createRecord: (threadId: string, dto: CreateRecordDto) => apiClient.post<InboxThreadListItem>(`/inbox/threads/${threadId}/records`, dto),

  // 고객·연결·병합(8) — OI-5·OI-6·OI-10
  searchCustomers: (dto: CustomerSearchDto) => apiClient.post<CustomerSearchResponse>('/inbox/customers/search', dto),
  createAnonymousCustomer: (dto: CreateAnonymousCustomerDto) => apiClient.post<CreateAnonymousCustomerResponse>('/inbox/customers', dto),
  sessionLink: (chatbotId: string, sessionRef: string) =>
    apiClient.get<SessionLinkLookupResponse>(`/inbox/session-link${buildQuery({ chatbotId, sessionRef })}`),
  identitySpaces: () => apiClient.get<IdentitySpaceListResponse>('/inbox/identity-spaces'),
  linkSession: (customerId: string, dto: LinkSessionDto) => apiClient.post<void>(`/inbox/customers/${customerId}/links`, dto),
  unlink: (customerId: string, linkId: string) => apiClient.delete<void>(`/inbox/customers/${customerId}/links/${linkId}`),
  merge: (customerId: string, dto: MergeCustomerDto) => apiClient.post<MergeResult>(`/inbox/customers/${customerId}/merge`, dto),
  revertMerge: (mergeId: string) => apiClient.post<RevertMergeResult>(`/inbox/merges/${mergeId}/revert`),

  // 시험 고객·시뮬레이션(3) — OI-7
  createTestCustomer: (dto: CreateTestCustomerDto) => apiClient.post<CreateTestCustomerResponse>('/inbox/test-customers', dto),
  removeTestCustomer: (customerId: string) => apiClient.delete<void>(`/inbox/test-customers/${customerId}`),
  simulate: (customerId: string, dto: SimulateInboxDto) => apiClient.post<SimulateInboxResponse>(`/inbox/test-customers/${customerId}/simulate`, dto),

  // 태그(4) — OI-8
  tags: {
    list: () => apiClient.get<InboxTagListResponse>('/inbox/tags'),
    create: (dto: InboxTagCreateDto) => apiClient.post<InboxTagItem>('/inbox/tags', dto),
    update: (tagId: string, dto: InboxTagUpdateDto) => apiClient.patch<InboxTagItem>(`/inbox/tags/${tagId}`, dto),
    remove: (tagId: string, force = false) => apiClient.delete<void>(`/inbox/tags/${tagId}${buildQuery({ force: force || undefined })}`),
  },

  // 챗봇별 참여 설정(3) — OI-9
  settings: {
    get: (chatbotId: string) => apiClient.get<ChatbotInboxSettingsResponse>(`/chatbots/${chatbotId}/inbox-settings`),
    update: (chatbotId: string, dto: ChatbotInboxSettingsUpdateDto) =>
      apiClient.put<ChatbotInboxSettingsResponse>(`/chatbots/${chatbotId}/inbox-settings`, dto),
    updateIdentity: (chatbotId: string, dto: ChatbotInboxIdentityUpdateDto) =>
      apiClient.put<ChatbotInboxSettingsResponse>(`/chatbots/${chatbotId}/inbox-settings/identity`, dto),
  },
};
