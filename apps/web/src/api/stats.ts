import { apiClient } from './client';
import type { DashboardSummary } from '@chat-bot/shared-types';

export interface DashboardQueryParams {
  chatbotId: string;
  from?: string;
  to?: string;
  topN?: number;
}

export const statsApi = {
  getDashboard: (params: DashboardQueryParams) => {
    const qs = new URLSearchParams();
    qs.set('chatbotId', params.chatbotId);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.topN) qs.set('topN', String(params.topN));
    return apiClient.get<DashboardSummary>(`/stats/dashboard?${qs.toString()}`);
  },
};
