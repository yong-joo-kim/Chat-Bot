import { apiClient } from './client';
import type {
  ApiConnection,
  ApiConnectionListItem,
  ApiConnectionPickerResponse,
  ApiConnectionSamplesResponse,
  ApiConnectionTestRequestDto,
  ApiConnectionTestResult,
  CreateApiConnectionDto,
  UpdateApiConnectionDto,
} from '@chat-bot/shared-types';

/**
 * [No.26] API 연결 레지스트리 관리(AC1, `legacy-api-integration-ui-spec.md` §3.1).
 * 전역 자원이라 `chatbotId`를 요구하지 않는다(J-2). `picker`는 `dialogue:read`로 호출 가능하다.
 */
export const apiConnectionsApi = {
  list: () => apiClient.get<{ items: ApiConnectionListItem[] }>('/api-connections'),
  picker: () => apiClient.get<ApiConnectionPickerResponse>('/api-connections/picker'),
  findOne: (id: string) => apiClient.get<ApiConnection>(`/api-connections/${id}`),
  samples: (id: string) => apiClient.get<ApiConnectionSamplesResponse>(`/api-connections/${id}/samples`),
  create: (dto: CreateApiConnectionDto) => apiClient.post<ApiConnection>('/api-connections', dto),
  update: (id: string, dto: UpdateApiConnectionDto) => apiClient.patch<ApiConnection>(`/api-connections/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/api-connections/${id}`),
  test: (id: string, dto: ApiConnectionTestRequestDto) => apiClient.post<ApiConnectionTestResult>(`/api-connections/${id}/test`, dto),
};
