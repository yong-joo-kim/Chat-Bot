import { apiClient } from './client';
import type {
  BulkIgnoreDto,
  BulkResolveDto,
  BulkResult,
  DecomposedResolveRequestDto,
  DecomposedResolveResult,
  DecompositionResponse,
  Paginated,
  ResolveResult,
  ResolveUnansweredQuestionDto,
  UnansweredQuestionDetail,
  UnansweredQuestionListItem,
  UnansweredQuestionStatus,
  UnansweredQuestionSummary,
  UnansweredSource,
} from '@chat-bot/shared-types';

export interface UnansweredListParams {
  status?: UnansweredQuestionStatus[];
  /** [신규 No.44] 없으면 전체 소스(feedback-loop-ui-spec.md §3.3). */
  source?: UnansweredSource[];
  from?: string;
  to?: string;
  q?: string;
  recurredOnly?: boolean;
  sort?: 'occurredCount' | 'lastOccurredAt' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function buildQuery(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      qs.set(key, value.join(','));
      continue;
    }
    if (value === false) continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** No.15 학습현황(미응답 큐) — 조회 `dialogue:read` / 반영·무시·재오픈·일괄 `dialogue:write`(FR-15-9~38). */
export const learningApi = {
  list: (chatbotId: string, params: UnansweredListParams) =>
    apiClient.get<Paginated<UnansweredQuestionListItem>>(`/chatbots/${chatbotId}/unanswered-questions${buildQuery(params)}`),
  /** 탭 배지·상한 배너 전용 경량 API(FR-15-14). */
  summary: (chatbotId: string) => apiClient.get<UnansweredQuestionSummary>(`/chatbots/${chatbotId}/unanswered-questions/summary`),
  findOne: (chatbotId: string, id: string) =>
    apiClient.get<UnansweredQuestionDetail>(`/chatbots/${chatbotId}/unanswered-questions/${id}`),
  resolve: (chatbotId: string, id: string, dto: ResolveUnansweredQuestionDto) =>
    apiClient.post<ResolveResult>(`/chatbots/${chatbotId}/unanswered-questions/${id}/resolve`, dto),
  ignore: (chatbotId: string, id: string) =>
    apiClient.post<UnansweredQuestionListItem>(`/chatbots/${chatbotId}/unanswered-questions/${id}/ignore`, undefined),
  reopen: (chatbotId: string, id: string) =>
    apiClient.post<UnansweredQuestionListItem>(`/chatbots/${chatbotId}/unanswered-questions/${id}/reopen`, undefined),
  /** [신규 No.44] "직접 수정 완료" — `NEGATIVE_FEEDBACK` ∧ `PENDING`일 때만 가능(§11.3). */
  markAddressed: (chatbotId: string, id: string) =>
    apiClient.post<UnansweredQuestionListItem>(`/chatbots/${chatbotId}/unanswered-questions/${id}/mark-addressed`, undefined),
  bulkResolve: (chatbotId: string, dto: BulkResolveDto) =>
    apiClient.post<BulkResult>(`/chatbots/${chatbotId}/unanswered-questions/bulk-resolve`, dto),
  bulkIgnore: (chatbotId: string, dto: BulkIgnoreDto) =>
    apiClient.post<BulkResult>(`/chatbots/${chatbotId}/unanswered-questions/bulk-ignore`, dto),
  /** No.23(A) 요소분해 — 조회 시 계산·저장하지 않는다(learning-augmentation-설계.md §15.1 #6). */
  decomposition: (chatbotId: string, id: string) =>
    apiClient.get<DecompositionResponse>(`/chatbots/${chatbotId}/unanswered-questions/${id}/decomposition`),
  /** 의도 + 엔티티 동시 반영(§15.1 #7). 엔티티 대기열이 비어있으면 `resolve`를 그대로 쓴다(무회귀). */
  resolveDecomposed: (chatbotId: string, id: string, dto: DecomposedResolveRequestDto) =>
    apiClient.post<DecomposedResolveResult>(`/chatbots/${chatbotId}/unanswered-questions/${id}/resolve-decomposed`, dto),
};
