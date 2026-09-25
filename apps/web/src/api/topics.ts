import { apiClient } from './client';
import type {
  CreateTopicDto,
  DeleteTopicQuery,
  MoveTopicDto,
  Topic,
  TopicAssignRequestDto,
  TopicAssignResult,
  TopicImpactPreview,
  TopicListResponse,
  TopicSplitPreview,
  TopicSplitRequestDto,
  TopicSplitResult,
  TopicSplitSelection,
  UpdateTopicDto,
} from '@chat-bot/shared-types';

/**
 * No.22 토픽 시스템 — `topic-system-설계.md` §16.1(엔드포인트 11개: `topics` 계열 10 +
 * `topic-assignments` 1). 정적 세그먼트(`split/preview`·`split`)가 `:topicId` 경로와 섞여 있으니
 * 서버와 같은 순서로 호출부를 정리했다(`topics.controller.ts` 참고).
 */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const topicsApi = {
  list: (chatbotId: string) => apiClient.get<TopicListResponse>(`/chatbots/${chatbotId}/topics`),
  create: (chatbotId: string, dto: CreateTopicDto) => apiClient.post<Topic>(`/chatbots/${chatbotId}/topics`, dto),
  update: (chatbotId: string, topicId: string, dto: UpdateTopicDto) =>
    apiClient.patch<Topic>(`/chatbots/${chatbotId}/topics/${topicId}`, dto),
  remove: (chatbotId: string, topicId: string, query: DeleteTopicQuery) =>
    apiClient.delete<void>(`/chatbots/${chatbotId}/topics/${topicId}${buildQuery(query)}`),
  move: (chatbotId: string, topicId: string, dto: MoveTopicDto) =>
    apiClient.post<{ items: Topic[] }>(`/chatbots/${chatbotId}/topics/${topicId}/move`, dto),
  enable: (chatbotId: string, topicId: string) => apiClient.post<Topic>(`/chatbots/${chatbotId}/topics/${topicId}/enable`, undefined),
  disable: (chatbotId: string, topicId: string) => apiClient.post<Topic>(`/chatbots/${chatbotId}/topics/${topicId}/disable`, undefined),
  impact: (chatbotId: string, topicId: string, action: 'ENABLE' | 'DISABLE') =>
    apiClient.get<TopicImpactPreview>(`/chatbots/${chatbotId}/topics/${topicId}/impact${buildQuery({ action })}`),
  splitPreview: (chatbotId: string, dto: TopicSplitSelection) =>
    apiClient.post<TopicSplitPreview>(`/chatbots/${chatbotId}/topics/split/preview`, dto),
  split: (chatbotId: string, dto: TopicSplitRequestDto) => apiClient.post<TopicSplitResult>(`/chatbots/${chatbotId}/topics/split`, dto),
};

export const topicAssignmentsApi = {
  assign: (chatbotId: string, dto: TopicAssignRequestDto) =>
    apiClient.post<TopicAssignResult>(`/chatbots/${chatbotId}/topic-assignments`, dto),
};
