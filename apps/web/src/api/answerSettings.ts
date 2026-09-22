import { apiClient } from './client';
import type {
  ChatbotAnswerSetting,
  RagConnectionCheckResult,
  ThresholdPreviewRequestDto,
  ThresholdPreviewResponse,
  UpdateAnswerSettingDto,
} from '@chat-bot/shared-types';

/**
 * AI 답변 설정(1단계 임계값 + 2단계 RAG 스코프) API — `nlu-rag-answering-설계.md` §10.1.
 * `PUT`은 부분 수정이 아니라 전체 교체다(상호 제약이 많아 부분 적용을 허용하지 않는다).
 */
export const answerSettingsApi = {
  get: (chatbotId: string) => apiClient.get<ChatbotAnswerSetting>(`/chatbots/${chatbotId}/answer-settings`),
  update: (chatbotId: string, dto: UpdateAnswerSettingDto) =>
    apiClient.put<ChatbotAnswerSetting>(`/chatbots/${chatbotId}/answer-settings`, dto),
  preview: (chatbotId: string, dto: ThresholdPreviewRequestDto) =>
    apiClient.post<ThresholdPreviewResponse>(`/chatbots/${chatbotId}/answer-settings/preview`, dto),
  test: (chatbotId: string) => apiClient.post<RagConnectionCheckResult>(`/chatbots/${chatbotId}/answer-settings/test`),
};
