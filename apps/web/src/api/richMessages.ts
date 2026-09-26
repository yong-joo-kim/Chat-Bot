import { apiClient } from './client';
import type { RichUrlPolicyResponse, UpdateRichUrlPolicyDto } from '@chat-bot/shared-types';

/** [신규 No.46] 챗봇별 리치 메시지(캐러셀·바로연결) 이미지·링크 허용 도메인(§9.3). */
export const richMessagesApi = {
  getUrlPolicy: (chatbotId: string) => apiClient.get<RichUrlPolicyResponse>(`/chatbots/${chatbotId}/rich-url-policy`),
  updateUrlPolicy: (chatbotId: string, dto: UpdateRichUrlPolicyDto) =>
    apiClient.put<RichUrlPolicyResponse>(`/chatbots/${chatbotId}/rich-url-policy`, dto),
};
