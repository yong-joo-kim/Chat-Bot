import { apiClient } from './client';
import type {
  ChatbotGroupWithCount,
  CopyChatbotGroupDto,
  CreateChatbotGroupDto,
  Paginated,
  UpdateChatbotGroupDto,
} from '@chat-bot/shared-types';

export const groupsApi = {
  list: () => apiClient.get<Paginated<ChatbotGroupWithCount>>('/chatbot-groups?page=1&pageSize=100'),
  create: (dto: CreateChatbotGroupDto) => apiClient.post<ChatbotGroupWithCount>('/chatbot-groups', dto),
  update: (id: string, dto: UpdateChatbotGroupDto) =>
    apiClient.patch<ChatbotGroupWithCount>(`/chatbot-groups/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/chatbot-groups/${id}`),
  copy: (id: string, dto: CopyChatbotGroupDto) =>
    apiClient.post<ChatbotGroupWithCount>(`/chatbot-groups/${id}/copy`, dto),
};
