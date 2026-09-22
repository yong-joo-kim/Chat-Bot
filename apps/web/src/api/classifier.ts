import { apiClient } from './client';
import type { IntentClassifierStatus, IntentClassifierTrainResponse } from '@chat-bot/shared-types';

/**
 * No.23(B) 경량 분류기(learning-augmentation-설계.md §15.1 #8~9) — 대화 매칭에는 쓰이지 않는
 * "추천 품질 보조 도구"다(J-6). 조회 `dialogue:read` / 재학습 `dialogue:write`.
 */
export const classifierApi = {
  status: (chatbotId: string) => apiClient.get<IntentClassifierStatus>(`/chatbots/${chatbotId}/intent-classifier/status`),
  train: (chatbotId: string) =>
    apiClient.post<IntentClassifierTrainResponse>(`/chatbots/${chatbotId}/intent-classifier/train`, undefined),
};
