import { apiClient } from './client';
import type {
  BannedWord,
  BannedWordListQuery,
  BannedWordTestResponse,
  CreateBannedWordDto,
  Paginated,
  UpdateBannedWordDto,
} from '@chat-bot/shared-types';

export interface BannedWordListParams {
  q?: string;
  policy?: BannedWordListQuery['policy'];
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

function buildQuery(params: BannedWordListParams): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.policy && params.policy.length > 0) qs.set('policy', params.policy.join(','));
  if (params.enabled !== undefined) qs.set('enabled', String(params.enabled));
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return qs.toString();
}

/** 금지어 관리(No.12-d, B1). 전역 1벌 사전이며 챗봇 스코프가 아니다(J-3). */
export const bannedWordsApi = {
  list: (params: BannedWordListParams) => apiClient.get<Paginated<BannedWord>>(`/banned-words?${buildQuery(params)}`),
  create: (dto: CreateBannedWordDto) => apiClient.post<BannedWord>('/banned-words', dto),
  update: (id: string, dto: UpdateBannedWordDto) => apiClient.patch<BannedWord>(`/banned-words/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/banned-words/${id}`),
  test: (text: string) => apiClient.post<BannedWordTestResponse>('/banned-words/test', { text }),
};
