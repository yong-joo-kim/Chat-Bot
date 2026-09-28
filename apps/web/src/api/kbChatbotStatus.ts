import { apiClient } from './client';
import type { ChatbotKbStatusResponse } from '@chat-bot/shared-types';

/** [신규 No.43] KB10 — 챗봇 답변 설정의 지식베이스 동기화 상태 카드(`chatbot:read`). */
export const chatbotKbStatusApi = {
  get: (chatbotId: string) => apiClient.get<ChatbotKbStatusResponse>(`/chatbots/${chatbotId}/kb-status`),
};
