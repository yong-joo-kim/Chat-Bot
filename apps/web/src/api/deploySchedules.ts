import { apiClient } from './client';
import type {
  CreateDeployScheduleDto,
  DeployScheduleDetail,
  DeployScheduleListItem,
  DeployScheduleListQuery,
  DeployScheduleMeta,
  DeployScheduleNotice,
  DeploySchedulePreviewResponse,
  DeployScheduleStateCheck,
  DeployScheduleSummary,
  Paginated,
  PreviewDeployScheduleDto,
  ReadinessWarning,
  ResumeDeployScheduleDto,
  UpdateDeployScheduleDto,
} from '@chat-bot/shared-types';

/** `deploy-schedule.service.ts#create()`가 `{ schedule, readinessWarnings }`을 반환한다(공유 타입 미노출). */
export interface CreateDeployScheduleResponse {
  schedule: DeployScheduleDetail;
  readinessWarnings: ReadinessWarning[];
}

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      qs.set(key, value.join(','));
      continue;
    }
    if (value instanceof Date) {
      qs.set(key, value.toISOString());
      continue;
    }
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * 운영 예약 배포(No.28) API 클라이언트. 챗봇 스코프 10개 + 전역 3개(`apps/api/src/deploy-schedules/*.controller.ts`).
 */
export const deploySchedulesApi = {
  list: (chatbotId: string, query: Partial<DeployScheduleListQuery> = {}) =>
    apiClient.get<Paginated<DeployScheduleListItem>>(`/chatbots/${chatbotId}/deploy-schedules${buildQuery(query)}`),
  notice: (chatbotId: string) => apiClient.get<DeployScheduleNotice>(`/chatbots/${chatbotId}/deploy-schedules/notice`),
  preview: (chatbotId: string, dto: PreviewDeployScheduleDto) =>
    apiClient.post<DeploySchedulePreviewResponse>(`/chatbots/${chatbotId}/deploy-schedules/preview`, dto),
  create: (chatbotId: string, dto: CreateDeployScheduleDto) =>
    apiClient.post<CreateDeployScheduleResponse>(`/chatbots/${chatbotId}/deploy-schedules`, dto),
  detail: (chatbotId: string, scheduleId: string) =>
    apiClient.get<DeployScheduleDetail>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}`),
  stateCheck: (chatbotId: string, scheduleId: string) =>
    apiClient.post<DeployScheduleStateCheck>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}/state-check`, undefined),
  update: (chatbotId: string, scheduleId: string, dto: UpdateDeployScheduleDto) =>
    apiClient.patch<DeployScheduleDetail>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}`, dto),
  cancel: (chatbotId: string, scheduleId: string) =>
    apiClient.post<DeployScheduleDetail>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}/cancel`, undefined),
  resume: (chatbotId: string, scheduleId: string, dto: ResumeDeployScheduleDto) =>
    apiClient.post<DeployScheduleDetail>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}/resume`, dto),
  acknowledge: (chatbotId: string, scheduleId: string) =>
    apiClient.post<DeployScheduleDetail>(`/chatbots/${chatbotId}/deploy-schedules/${scheduleId}/acknowledge`, undefined),
  globalList: (query: Partial<DeployScheduleListQuery> = {}) =>
    apiClient.get<Paginated<DeployScheduleListItem>>(`/deploy-schedules${buildQuery(query)}`),
  summary: () => apiClient.get<DeployScheduleSummary>('/deploy-schedules/summary'),
  meta: () => apiClient.get<DeployScheduleMeta>('/deploy-schedules/meta'),
};
