import { apiClient } from './client';
import type {
  DisableEnvironmentDto,
  DisableEnvironmentPreviewResponse,
  DisableEnvironmentResponse,
  EnableEnvironmentDto,
  EnableEnvironmentPreviewResponse,
  EnableEnvironmentResponse,
  EnvironmentGateSettings,
  EnvironmentHistoryQuery,
  EnvironmentStatus,
  EnvironmentSwitchLogItem,
  Paginated,
  ProdRollbackDto,
  ProdSwitchDto,
  ProdSwitchPreviewDto,
  ProdSwitchPreviewResponse,
  ProdSwitchResponse,
  PromoteToStagingDto,
  PromoteToStagingResponse,
  UpdateEnvironmentGateDto,
} from '@chat-bot/shared-types';

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * 환경 분리 / 버전 관리(No.40) API 클라이언트. 실제 라우트는
 * `apps/api/src/environment/environment.controller.ts`(코드 확인) — 11개 핸들러.
 */
export const environmentApi = {
  getStatus: (chatbotId: string) => apiClient.get<EnvironmentStatus>(`/chatbots/${chatbotId}/environment`),
  enablePreview: (chatbotId: string) =>
    apiClient.post<EnableEnvironmentPreviewResponse>(`/chatbots/${chatbotId}/environment/enable/preview`, undefined),
  enable: (chatbotId: string, dto: EnableEnvironmentDto) =>
    apiClient.post<EnableEnvironmentResponse>(`/chatbots/${chatbotId}/environment/enable`, dto),
  disablePreview: (chatbotId: string) =>
    apiClient.post<DisableEnvironmentPreviewResponse>(`/chatbots/${chatbotId}/environment/disable/preview`, undefined),
  disable: (chatbotId: string, dto: DisableEnvironmentDto) =>
    apiClient.post<DisableEnvironmentResponse>(`/chatbots/${chatbotId}/environment/disable`, dto),
  promote: (chatbotId: string, dto: PromoteToStagingDto) =>
    apiClient.post<PromoteToStagingResponse>(`/chatbots/${chatbotId}/environment/staging/promote`, dto),
  prodPreview: (chatbotId: string, dto: ProdSwitchPreviewDto) =>
    apiClient.post<ProdSwitchPreviewResponse>(`/chatbots/${chatbotId}/environment/prod/preview`, dto),
  prodSwitch: (chatbotId: string, dto: ProdSwitchDto) =>
    apiClient.post<ProdSwitchResponse>(`/chatbots/${chatbotId}/environment/prod/switch`, dto),
  prodRollback: (chatbotId: string, dto: ProdRollbackDto) =>
    apiClient.post<ProdSwitchResponse>(`/chatbots/${chatbotId}/environment/prod/rollback`, dto),
  history: (chatbotId: string, query: Partial<EnvironmentHistoryQuery> = {}) =>
    apiClient.get<Paginated<EnvironmentSwitchLogItem>>(`/chatbots/${chatbotId}/environment/history${buildQuery(query)}`),
  updateGate: (chatbotId: string, dto: UpdateEnvironmentGateDto) =>
    apiClient.put<EnvironmentGateSettings>(`/chatbots/${chatbotId}/environment/gate`, dto),
};
