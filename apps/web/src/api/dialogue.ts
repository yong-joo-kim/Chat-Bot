import { apiClient, API_BASE_URL } from './client';
import type {
  BulkDeleteDto,
  ContextListItem,
  ContextListQuery,
  ContextVariable,
  CreateContextDto,
  CreateDialogNodeDto,
  CreateFaqDto,
  CreateHomonymDto,
  CreateIntentDto,
  CreateKeywordDto,
  CopyDialogNodeDto,
  DesignValidationReport,
  DialogNode,
  DialogNodeCopyResponse,
  DialogNodeListItem,
  DialogNodeListQuery,
  FaqEntry,
  FaqListQuery,
  FaqListResponse,
  FaqPublicSuggestion,
  FaqSuggestQuery,
  FaqSuggestion,
  FlowTree,
  HomonymDictionary,
  HomonymListItem,
  HomonymListQuery,
  HomonymResolution,
  DialogOutput,
  TraceStep,
  ImportCommitRequestDto,
  ImportCommitResult,
  ImportValidateResult,
  IntentDetail,
  IntentExampleMutationDto,
  IntentListItem,
  IntentListQuery,
  IntentMutationResult,
  KeywordDetail,
  KeywordListItem,
  KeywordListQuery,
  Paginated,
  UpdateContextDto,
  UpdateDialogNodeDto,
  UpdateFaqDto,
  UpdateHomonymDto,
  UpdateIntentDto,
  UpdateKeywordDto,
} from '@chat-bot/shared-types';

/** 목록 공통 쿼리(q/sort/order/page/pageSize)를 querystring으로 직렬화한다. */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/* ------------------------------------------------------------------------------------------------
 * 의도(Intent)
 * ---------------------------------------------------------------------------------------------- */
export const intentsApi = {
  list: (chatbotId: string, query: Partial<IntentListQuery>) =>
    apiClient.get<Paginated<IntentListItem>>(`/chatbots/${chatbotId}/intents${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<IntentDetail>(`/chatbots/${chatbotId}/intents/${id}`),
  create: (chatbotId: string, dto: CreateIntentDto) =>
    apiClient.post<IntentMutationResult>(`/chatbots/${chatbotId}/intents`, dto),
  update: (chatbotId: string, id: string, dto: UpdateIntentDto) =>
    apiClient.patch<IntentMutationResult>(`/chatbots/${chatbotId}/intents/${id}`, dto),
  updateExamples: (chatbotId: string, id: string, dto: IntentExampleMutationDto) =>
    apiClient.patch<IntentMutationResult>(`/chatbots/${chatbotId}/intents/${id}/examples`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/intents/${id}`),
  bulkDelete: (chatbotId: string, dto: BulkDeleteDto) =>
    apiClient.post<void>(`/chatbots/${chatbotId}/intents/bulk-delete`, dto),
  importValidate: (chatbotId: string, formData: FormData) =>
    apiClient.postForm<ImportValidateResult>(`/chatbots/${chatbotId}/intents/import/validate`, formData),
  importCommit: (chatbotId: string, dto: ImportCommitRequestDto) =>
    apiClient.post<ImportCommitResult>(`/chatbots/${chatbotId}/intents/import/commit`, dto),
  templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') =>
    `${API_BASE_URL}/chatbots/${chatbotId}/intents/import/template?format=${format}`,
  exportUrl: (chatbotId: string) => `${API_BASE_URL}/chatbots/${chatbotId}/intents/export`,
};

/* ------------------------------------------------------------------------------------------------
 * 키워드(Keyword)
 * ---------------------------------------------------------------------------------------------- */
export const keywordsApi = {
  list: (chatbotId: string, query: Partial<KeywordListQuery>) =>
    apiClient.get<Paginated<KeywordListItem>>(`/chatbots/${chatbotId}/keywords${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<KeywordDetail>(`/chatbots/${chatbotId}/keywords/${id}`),
  create: (chatbotId: string, dto: CreateKeywordDto) =>
    apiClient.post<KeywordDetail>(`/chatbots/${chatbotId}/keywords`, dto),
  update: (chatbotId: string, id: string, dto: UpdateKeywordDto) =>
    apiClient.patch<KeywordDetail>(`/chatbots/${chatbotId}/keywords/${id}`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/keywords/${id}`),
  bulkDelete: (chatbotId: string, dto: BulkDeleteDto) =>
    apiClient.post<void>(`/chatbots/${chatbotId}/keywords/bulk-delete`, dto),
  importValidate: (chatbotId: string, formData: FormData) =>
    apiClient.postForm<ImportValidateResult>(`/chatbots/${chatbotId}/keywords/import/validate`, formData),
  importCommit: (chatbotId: string, dto: ImportCommitRequestDto) =>
    apiClient.post<ImportCommitResult>(`/chatbots/${chatbotId}/keywords/import/commit`, dto),
  templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') =>
    `${API_BASE_URL}/chatbots/${chatbotId}/keywords/import/template?format=${format}`,
  exportUrl: (chatbotId: string) => `${API_BASE_URL}/chatbots/${chatbotId}/keywords/export`,
};

/* ------------------------------------------------------------------------------------------------
 * 동음이의어/다의어 사전
 * ---------------------------------------------------------------------------------------------- */
export const homonymsApi = {
  list: (chatbotId: string, query: Partial<HomonymListQuery>) =>
    apiClient.get<Paginated<HomonymListItem>>(`/chatbots/${chatbotId}/homonyms${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<HomonymDictionary>(`/chatbots/${chatbotId}/homonyms/${id}`),
  create: (chatbotId: string, dto: CreateHomonymDto) =>
    apiClient.post<HomonymDictionary>(`/chatbots/${chatbotId}/homonyms`, dto),
  update: (chatbotId: string, id: string, dto: UpdateHomonymDto) =>
    apiClient.patch<HomonymDictionary>(`/chatbots/${chatbotId}/homonyms/${id}`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/homonyms/${id}`),
  test: (chatbotId: string, text: string) =>
    apiClient.post<{ resolution: HomonymResolution | null; outputs: DialogOutput[]; trace: TraceStep[] }>(
      `/chatbots/${chatbotId}/homonyms/test`,
      { text },
    ),
};

/* ------------------------------------------------------------------------------------------------
 * 컨텍스트(멀티턴·슬롯필링)
 * ---------------------------------------------------------------------------------------------- */
export const contextsApi = {
  list: (chatbotId: string, query: Partial<ContextListQuery>) =>
    apiClient.get<Paginated<ContextListItem>>(`/chatbots/${chatbotId}/contexts${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<ContextVariable>(`/chatbots/${chatbotId}/contexts/${id}`),
  create: (chatbotId: string, dto: CreateContextDto) =>
    apiClient.post<ContextVariable>(`/chatbots/${chatbotId}/contexts`, dto),
  update: (chatbotId: string, id: string, dto: UpdateContextDto) =>
    apiClient.patch<ContextVariable>(`/chatbots/${chatbotId}/contexts/${id}`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/contexts/${id}`),
};

/* ------------------------------------------------------------------------------------------------
 * 대화 노드
 * ---------------------------------------------------------------------------------------------- */
export const dialogNodesApi = {
  list: (chatbotId: string, query: Partial<DialogNodeListQuery>) =>
    apiClient.get<Paginated<DialogNodeListItem>>(`/chatbots/${chatbotId}/dialog-nodes${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<DialogNode>(`/chatbots/${chatbotId}/dialog-nodes/${id}`),
  create: (chatbotId: string, dto: CreateDialogNodeDto) =>
    apiClient.post<DialogNode>(`/chatbots/${chatbotId}/dialog-nodes`, dto),
  update: (chatbotId: string, id: string, dto: UpdateDialogNodeDto) =>
    apiClient.patch<DialogNode>(`/chatbots/${chatbotId}/dialog-nodes/${id}`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/dialog-nodes/${id}`),
  copy: (chatbotId: string, id: string, dto: CopyDialogNodeDto = {}) =>
    apiClient.post<DialogNodeCopyResponse>(`/chatbots/${chatbotId}/dialog-nodes/${id}/copy`, dto),
  flow: (chatbotId: string) => apiClient.get<FlowTree>(`/chatbots/${chatbotId}/dialog-nodes/flow`),
  validate: (chatbotId: string) =>
    apiClient.post<DesignValidationReport>(`/chatbots/${chatbotId}/dialog-nodes/validate`, undefined),
};

/* ------------------------------------------------------------------------------------------------
 * FAQ
 * ---------------------------------------------------------------------------------------------- */
export const faqsApi = {
  list: (chatbotId: string, query: Partial<FaqListQuery>) =>
    apiClient.get<FaqListResponse>(`/chatbots/${chatbotId}/faqs${buildQuery(query)}`),
  findOne: (chatbotId: string, id: string) => apiClient.get<FaqEntry>(`/chatbots/${chatbotId}/faqs/${id}`),
  create: (chatbotId: string, dto: CreateFaqDto) => apiClient.post<FaqEntry>(`/chatbots/${chatbotId}/faqs`, dto),
  update: (chatbotId: string, id: string, dto: UpdateFaqDto) =>
    apiClient.patch<FaqEntry>(`/chatbots/${chatbotId}/faqs/${id}`, dto),
  remove: (chatbotId: string, id: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/faqs/${id}`),
  bulkDelete: (chatbotId: string, dto: BulkDeleteDto) =>
    apiClient.post<void>(`/chatbots/${chatbotId}/faqs/bulk-delete`, dto),
  suggest: (chatbotId: string, query: FaqSuggestQuery) =>
    apiClient.get<FaqSuggestion[] | FaqPublicSuggestion[]>(`/chatbots/${chatbotId}/faqs/suggest${buildQuery(query)}`),
  importValidate: (chatbotId: string, formData: FormData) =>
    apiClient.postForm<ImportValidateResult>(`/chatbots/${chatbotId}/faqs/import/validate`, formData),
  importCommit: (chatbotId: string, dto: ImportCommitRequestDto) =>
    apiClient.post<ImportCommitResult>(`/chatbots/${chatbotId}/faqs/import/commit`, dto),
  templateUrl: (chatbotId: string, format: 'csv' | 'xlsx') =>
    `${API_BASE_URL}/chatbots/${chatbotId}/faqs/import/template?format=${format}`,
  exportUrl: (chatbotId: string) => `${API_BASE_URL}/chatbots/${chatbotId}/faqs/export`,
};
