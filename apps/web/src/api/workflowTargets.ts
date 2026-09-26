import { apiClient } from './client';
import type {
  CreateWorkflowTargetDto,
  UpdateWorkflowTargetDto,
  WorkflowTarget,
  WorkflowTargetListResponse,
  WorkflowTargetPickerResponse,
  WorkflowTestSendRequestDto,
  WorkflowTestSendResult,
} from '@chat-bot/shared-types';

/**
 * [No.41] 업무 자동화 발송 대상 레지스트리(전역, `workflow-automation-ui-spec.md` §3.1).
 * `security:read`(조회)/`security:write`(쓰기·테스트·정지)를 요구한다 — No.26 `apiConnectionsApi`와
 * 동일한 형태(전역 자원이라 `chatbotId` 불요).
 */
export const workflowTargetsApi = {
  list: () => apiClient.get<WorkflowTargetListResponse>('/workflow-targets'),
  picker: () => apiClient.get<WorkflowTargetPickerResponse>('/workflow-targets/picker'),
  findOne: (id: string) => apiClient.get<WorkflowTarget>(`/workflow-targets/${id}`),
  create: (dto: CreateWorkflowTargetDto) => apiClient.post<WorkflowTarget>('/workflow-targets', dto),
  update: (id: string, dto: UpdateWorkflowTargetDto) => apiClient.patch<WorkflowTarget>(`/workflow-targets/${id}`, dto),
  remove: (id: string) => apiClient.delete<void>(`/workflow-targets/${id}`),
  test: (id: string, dto: WorkflowTestSendRequestDto) => apiClient.post<WorkflowTestSendResult>(`/workflow-targets/${id}/test`, dto),
  pause: (id: string) => apiClient.post<{ heldCount: number }>(`/workflow-targets/${id}/pause`, undefined),
  resume: (id: string) => apiClient.post<{ pendingCount: number; expiredCount: number }>(`/workflow-targets/${id}/resume`, undefined),
};
