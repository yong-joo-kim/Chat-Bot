import { apiClient } from './client';
import type {
  GuardrailEventItem,
  GuardrailEventListQuery,
  GuardrailOverview,
  GuardrailRule,
  GuardrailRuleBody,
  GuardrailRuleListResponse,
  GuardrailRuleSaveResponse,
  GuardrailSettingsResponse,
  GuardrailTestRequest,
  GuardrailTestResponse,
  Paginated,
  UpdateGuardrailSettingsDto,
} from '@chat-bot/shared-types';

/** 값이 없거나 빈 값은 건너뛴다. */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

const base = (chatbotId: string): string => `/chatbots/${chatbotId}/guardrails`;

/** 안전 가드레일(No.36) 관리 API — 13개 핸들러 전부(`ai-guardrails-ui-spec.md` §13.1). 경로는 챗봇 스코프다. */
export const guardrailsApi = {
  listRules: (chatbotId: string) => apiClient.get<GuardrailRuleListResponse>(`${base(chatbotId)}/rules`),
  createRule: (chatbotId: string, dto: GuardrailRuleBody) => apiClient.post<GuardrailRuleSaveResponse>(`${base(chatbotId)}/rules`, dto),
  getRule: (chatbotId: string, ruleId: string) => apiClient.get<GuardrailRule>(`${base(chatbotId)}/rules/${ruleId}`),
  updateRule: (chatbotId: string, ruleId: string, dto: GuardrailRuleBody) => apiClient.put<GuardrailRuleSaveResponse>(`${base(chatbotId)}/rules/${ruleId}`, dto),
  deleteRule: (chatbotId: string, ruleId: string) => apiClient.delete<void>(`${base(chatbotId)}/rules/${ruleId}`),
  enableRule: (chatbotId: string, ruleId: string) => apiClient.post<GuardrailRule>(`${base(chatbotId)}/rules/${ruleId}/enable`),
  disableRule: (chatbotId: string, ruleId: string) => apiClient.post<GuardrailRule>(`${base(chatbotId)}/rules/${ruleId}/disable`),
  moveRule: (chatbotId: string, ruleId: string, direction: 'UP' | 'DOWN') =>
    apiClient.post<GuardrailRule[]>(`${base(chatbotId)}/rules/${ruleId}/move`, { direction }),
  test: (chatbotId: string, dto: GuardrailTestRequest) => apiClient.post<GuardrailTestResponse>(`${base(chatbotId)}/test`, dto),
  getSettings: (chatbotId: string) => apiClient.get<GuardrailSettingsResponse>(`${base(chatbotId)}/settings`),
  updateSettings: (chatbotId: string, dto: UpdateGuardrailSettingsDto) => apiClient.put<GuardrailSettingsResponse>(`${base(chatbotId)}/settings`, dto),
  getOverview: (chatbotId: string, query: { from?: string; to?: string }) =>
    apiClient.get<GuardrailOverview>(`${base(chatbotId)}/overview${buildQuery(query)}`),
  listEvents: (chatbotId: string, query: Partial<Omit<GuardrailEventListQuery, 'from' | 'to'>> & { from: string; to: string }) =>
    apiClient.get<Paginated<GuardrailEventItem>>(`${base(chatbotId)}/events${buildQuery(query)}`),
};
