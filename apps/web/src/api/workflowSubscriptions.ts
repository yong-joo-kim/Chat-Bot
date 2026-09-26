import { apiClient } from './client';
import type {
  CreateWorkflowSubscriptionDto,
  UpdateWorkflowSubscriptionDto,
  WorkflowRunBulkRequestDto,
  WorkflowRunBulkResult,
  WorkflowRunListQuery,
  WorkflowRunListResponse,
  WorkflowSubscription,
  WorkflowSubscriptionListResponse,
  WorkflowSummaryResponse,
} from '@chat-bot/shared-types';
import { buildWorkflowRunQuery } from './workflowRuns';

/**
 * [No.41] 챗봇 스코프 이벤트 구독(WF3, `workflow-automation-ui-spec.md` §3.5) — 조회는
 * `chatbot:read`+`dialogue:read`, 쓰기·정지는 `chatbot:write`.
 */
export const workflowSubscriptionsApi = {
  list: (chatbotId: string) => apiClient.get<WorkflowSubscriptionListResponse>(`/chatbots/${chatbotId}/workflow-subscriptions`),
  create: (chatbotId: string, dto: CreateWorkflowSubscriptionDto) =>
    apiClient.post<WorkflowSubscription>(`/chatbots/${chatbotId}/workflow-subscriptions`, dto),
  update: (chatbotId: string, subscriptionId: string, dto: UpdateWorkflowSubscriptionDto) =>
    apiClient.patch<WorkflowSubscription>(`/chatbots/${chatbotId}/workflow-subscriptions/${subscriptionId}`, dto),
  remove: (chatbotId: string, subscriptionId: string) =>
    apiClient.delete<void>(`/chatbots/${chatbotId}/workflow-subscriptions/${subscriptionId}`),
  pause: (chatbotId: string, subscriptionId: string) =>
    apiClient.post<WorkflowSubscription>(`/chatbots/${chatbotId}/workflow-subscriptions/${subscriptionId}/pause`, undefined),
  resume: (chatbotId: string, subscriptionId: string) =>
    apiClient.post<WorkflowSubscription>(`/chatbots/${chatbotId}/workflow-subscriptions/${subscriptionId}/resume`, undefined),
};

/**
 * [No.41] 챗봇 스코프 실행 이력·재발송/취소(WF3-b, §3.2b) — 조회는 `chatbot:read`+`dialogue:read`,
 * 재발송·취소는 `chatbot:write`.
 */
export const chatbotWorkflowRunsApi = {
  list: (chatbotId: string, query: Partial<WorkflowRunListQuery>) =>
    apiClient.get<WorkflowRunListResponse>(`/chatbots/${chatbotId}/workflow-runs${buildWorkflowRunQuery(query)}`),
  summary: (chatbotId: string, days: 7 | 30 = 7) =>
    apiClient.get<WorkflowSummaryResponse>(`/chatbots/${chatbotId}/workflow-runs/summary${buildWorkflowRunQuery({ days })}`),
  retry: (chatbotId: string, dto: WorkflowRunBulkRequestDto) =>
    apiClient.post<WorkflowRunBulkResult>(`/chatbots/${chatbotId}/workflow-runs/retry`, dto),
  cancel: (chatbotId: string, dto: WorkflowRunBulkRequestDto) =>
    apiClient.post<WorkflowRunBulkResult>(`/chatbots/${chatbotId}/workflow-runs/cancel`, dto),
};
