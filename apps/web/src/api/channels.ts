import { apiClient } from './client';
import type { ChannelListItem, ChannelType, UpdateChannelDto } from '@chat-bot/shared-types';

/** No.11 채널 관리(FR-11-1~13). `implementation`/`enabled`/`configured`는 항상 응답값을 그대로 렌더한다(DD-29). */
export const channelsApi = {
  list: (chatbotId: string) => apiClient.get<{ items: ChannelListItem[] }>(`/chatbots/${chatbotId}/channels`),
  upsert: (chatbotId: string, type: ChannelType, dto: UpdateChannelDto) =>
    apiClient.patch<ChannelListItem>(`/chatbots/${chatbotId}/channels/${type}`, dto),
  remove: (chatbotId: string, type: ChannelType) => apiClient.delete<void>(`/chatbots/${chatbotId}/channels/${type}`),
};
