import { apiClient } from './client';
import type {
  Chatbot,
  ChatbotListItem,
  ChatbotStatus,
  CopyChatbotDto,
  CreateChatbotDto,
  EmbedCode,
  MoveChatbotGroupDto,
  Paginated,
  PermanentDeleteChatbotDto,
  SlugAvailability,
  UpdateChatbotSettingsDto,
  UpdateChatbotSkinDto,
  UpdateChatbotStatusDto,
} from '@chat-bot/shared-types';

export interface ChatbotListParams {
  groupId?: string;
  status?: ChatbotStatus[];
  q?: string;
  sort?: 'createdAt' | 'updatedAt' | 'name';
  order?: 'asc' | 'desc';
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}

function buildListQuery(params: ChatbotListParams): string {
  const qs = new URLSearchParams();
  if (params.groupId) qs.set('groupId', params.groupId);
  if (params.status && params.status.length > 0) qs.set('status', params.status.join(','));
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  if (params.includeArchived) qs.set('includeArchived', 'true');
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return qs.toString();
}

export const chatbotsApi = {
  list: (params: ChatbotListParams) => apiClient.get<Paginated<ChatbotListItem>>(`/chatbots?${buildListQuery(params)}`),
  create: (dto: CreateChatbotDto) => apiClient.post<Chatbot>('/chatbots', dto),
  findOne: (id: string) => apiClient.get<Chatbot>(`/chatbots/${id}`),
  updateSettings: (id: string, dto: UpdateChatbotSettingsDto) =>
    apiClient.patch<Chatbot>(`/chatbots/${id}/settings`, dto),
  updateSkin: (id: string, dto: UpdateChatbotSkinDto) => apiClient.patch<Chatbot>(`/chatbots/${id}/skin`, dto),
  updateStatus: (id: string, dto: UpdateChatbotStatusDto) => apiClient.patch<Chatbot>(`/chatbots/${id}/status`, dto),
  moveGroup: (id: string, dto: MoveChatbotGroupDto) => apiClient.patch<Chatbot>(`/chatbots/${id}/group`, dto),
  copy: (id: string, dto: CopyChatbotDto) => apiClient.post<Chatbot>(`/chatbots/${id}/copy`, dto),
  archive: (id: string) => apiClient.delete<void>(`/chatbots/${id}`),
  permanentDelete: (id: string, dto: PermanentDeleteChatbotDto) =>
    apiClient.post<void>(`/chatbots/${id}/permanent-delete`, dto),
  embedCode: (id: string) => apiClient.get<EmbedCode>(`/chatbots/${id}/embed-code`),
  slugAvailable: (slug: string, excludeChatbotId?: string) => {
    const qs = new URLSearchParams({ slug });
    if (excludeChatbotId) qs.set('excludeChatbotId', excludeChatbotId);
    return apiClient.get<SlugAvailability>(`/chatbots/slug-available?${qs.toString()}`);
  },
};
