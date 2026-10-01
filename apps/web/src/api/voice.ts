import { apiClient } from './client';
import type { VoiceOverviewResponse, VoiceSettingsInput, VoiceSettingsView, VoiceStatsQuery, VoiceStatsResponse } from '@chat-bot/shared-types';

/**
 * [신규 No.32] 음성 AI 관리 API(voice-ai-설계.md §10.1 — 3 핸들러). 저장은 **전체 교체 PUT**이다.
 * 들어보기(서버 호출 0)용 API는 없다 — 관리자 브라우저에서 기기 음성으로 재생한다(FR-VO5-3).
 */
export const voiceApi = {
  getOverview: (chatbotId: string) => apiClient.get<VoiceOverviewResponse>(`/chatbots/${chatbotId}/voice`),
  saveSettings: (chatbotId: string, dto: VoiceSettingsInput) => apiClient.put<VoiceSettingsView>(`/chatbots/${chatbotId}/voice`, dto),
  getStats: (chatbotId: string, query: VoiceStatsQuery = {}) => {
    const qs = new URLSearchParams();
    if (query.from) qs.set('from', query.from);
    if (query.to) qs.set('to', query.to);
    const suffix = qs.toString();
    return apiClient.get<VoiceStatsResponse>(`/chatbots/${chatbotId}/voice/stats${suffix ? `?${suffix}` : ''}`);
  },
};
