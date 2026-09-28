import { apiClient } from './client';
import type {
  MoveProactiveRuleDto,
  ProactiveOverviewResponse,
  ProactiveRuleInput,
  ProactiveRuleView,
  ProactiveSettingsInput,
  ProactiveStatsQuery,
  ProactiveStatsResponse,
} from '@chat-bot/shared-types';

/** [신규 No.35] 선제 안내(Proactive Messaging) 관리 API(설계서 §9.1 — 10 핸들러). */
export const proactiveApi = {
  getOverview: (chatbotId: string) => apiClient.get<ProactiveOverviewResponse>(`/chatbots/${chatbotId}/proactive`),
  saveSettings: (chatbotId: string, dto: ProactiveSettingsInput) =>
    apiClient.put<{ enabled: boolean; maxPerSession: number; minIntervalSec: number; quietAfterUserMessageSec: number; updatedAt: string | null }>(
      `/chatbots/${chatbotId}/proactive/settings`,
      dto,
    ),
  createRule: (chatbotId: string, dto: ProactiveRuleInput) => apiClient.post<ProactiveRuleView>(`/chatbots/${chatbotId}/proactive/rules`, dto),
  getRule: (chatbotId: string, ruleId: string) => apiClient.get<ProactiveRuleView>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}`),
  updateRule: (chatbotId: string, ruleId: string, dto: ProactiveRuleInput) =>
    apiClient.put<ProactiveRuleView>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}`, dto),
  deleteRule: (chatbotId: string, ruleId: string) => apiClient.delete<void>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}`),
  enableRule: (chatbotId: string, ruleId: string) => apiClient.post<ProactiveRuleView>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}/enable`),
  disableRule: (chatbotId: string, ruleId: string) => apiClient.post<ProactiveRuleView>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}/disable`),
  moveRule: (chatbotId: string, ruleId: string, dto: MoveProactiveRuleDto) =>
    apiClient.post<ProactiveRuleView[]>(`/chatbots/${chatbotId}/proactive/rules/${ruleId}/move`, dto),
  getStats: (chatbotId: string, query: ProactiveStatsQuery) => {
    const qs = new URLSearchParams();
    if (query.from) qs.set('from', query.from);
    if (query.to) qs.set('to', query.to);
    const suffix = qs.toString();
    return apiClient.get<ProactiveStatsResponse>(`/chatbots/${chatbotId}/proactive/stats${suffix ? `?${suffix}` : ''}`);
  },
};
