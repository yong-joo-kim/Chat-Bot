import { apiClient } from './client';
import type {
  AugmentationAcceptRequestDto,
  AugmentationAcceptResponse,
  AugmentationCapability,
  AugmentationGenerateRequestDto,
  AugmentationGenerateResponse,
  AugmentationListQuery,
  AugmentationListResponse,
  AugmentationRejectRequestDto,
  AugmentationRejectResponse,
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
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * No.16 예문 증강(learning-augmentation-설계.md §15.1 #1~5) — 조회 `dialogue:read` /
 * 생성·승인·거절 `dialogue:write`. 자산 승격은 `accept` 1경로뿐이다(ADR-0025).
 */
export const augmentationsApi = {
  generate: (chatbotId: string, intentId: string, dto: AugmentationGenerateRequestDto = {}) =>
    apiClient.post<AugmentationGenerateResponse>(`/chatbots/${chatbotId}/intents/${intentId}/augmentations`, dto),
  list: (chatbotId: string, intentId: string, query: Partial<AugmentationListQuery> = {}) =>
    apiClient.get<AugmentationListResponse>(`/chatbots/${chatbotId}/intents/${intentId}/augmentations${buildQuery(query)}`),
  capability: (chatbotId: string) => apiClient.get<AugmentationCapability>(`/chatbots/${chatbotId}/augmentations/capability`),
  accept: (chatbotId: string, intentId: string, dto: AugmentationAcceptRequestDto) =>
    apiClient.post<AugmentationAcceptResponse>(`/chatbots/${chatbotId}/intents/${intentId}/augmentations/accept`, dto),
  reject: (chatbotId: string, intentId: string, dto: AugmentationRejectRequestDto) =>
    apiClient.post<AugmentationRejectResponse>(`/chatbots/${chatbotId}/intents/${intentId}/augmentations/reject`, dto),
};
