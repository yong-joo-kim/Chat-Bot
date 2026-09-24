import { apiClient } from './client';
import type {
  CannedResponse,
  CannedResponseListQuery,
  CreateCannedResponseDto,
  MoveCannedResponseDto,
  UpdateCannedResponseDto,
} from '@chat-bot/shared-types';

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** 자주 쓰는 문장(CR1) API 클라이언트(hybrid-cs-설계.md §17.1 ⑬~⑰). */
export const cannedResponsesApi = {
  list: (chatbotId: string) => apiClient.get<CannedResponse[]>(`/chatbots/${chatbotId}/canned-responses`),
  search: (chatbotId: string, query: Partial<CannedResponseListQuery> = {}) =>
    apiClient.get<{ items: CannedResponse[] }>(`/chatbots/${chatbotId}/handoffs/canned-responses${buildQuery(query)}`),
  create: (chatbotId: string, dto: CreateCannedResponseDto) =>
    apiClient.post<CannedResponse>(`/chatbots/${chatbotId}/canned-responses`, dto),
  update: (chatbotId: string, cannedId: string, dto: UpdateCannedResponseDto) =>
    apiClient.patch<CannedResponse>(`/chatbots/${chatbotId}/canned-responses/${cannedId}`, dto),
  remove: (chatbotId: string, cannedId: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/canned-responses/${cannedId}`),
  move: (chatbotId: string, cannedId: string, dto: MoveCannedResponseDto) =>
    apiClient.post<{ items: CannedResponse[] }>(`/chatbots/${chatbotId}/canned-responses/${cannedId}/move`, dto),
};
