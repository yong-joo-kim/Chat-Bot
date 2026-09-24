import { apiClient } from './client';
import type {
  HandoffConsoleResponse,
  HandoffDetail,
  HandoffHistoryDetailResponse,
  HandoffHistoryItem,
  HandoffHistoryQuery,
  HandoffSettings,
  HandoffSummaryResponse,
  HintResponse,
  InterveneHandoffResponse,
  LiveSessionListQuery,
  LiveSessionListResponse,
  MaskPreviewRequestDto,
  MaskPreviewResponse,
  Paginated,
  SendAgentMessageDto,
  SendAgentMessageResponse,
  TakeoverHandoffDto,
  TranscriptQuery,
  TranscriptResponse,
  UpdateHandoffSettingsDto,
} from '@chat-bot/shared-types';

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
 * 하이브리드 CS(No.24) 관리자 API 클라이언트(hybrid-cs-설계.md §17.1 ①~⑫·⑱~⑳).
 * ⚠ 관리자 응답에는 전체 `sessionId`가 없다 — 경로에는 항상 `sessionRef`(별칭 원천)만 쓴다.
 */
export const handoffApi = {
  // 전역 — 상담 콘솔 챗봇 선택기(⑳)
  consoleChatbots: () => apiClient.get<HandoffConsoleResponse>('/handoff-console/chatbots'),

  // 진행 중 목록·대화 보기·힌트·개입 (①~④)
  liveSessions: (chatbotId: string, query: Partial<LiveSessionListQuery> = {}) =>
    apiClient.get<LiveSessionListResponse>(`/chatbots/${chatbotId}/live-sessions${buildQuery(query)}`),
  transcript: (chatbotId: string, sessionRef: string, query: TranscriptQuery) =>
    apiClient.get<TranscriptResponse>(`/chatbots/${chatbotId}/live-sessions/${sessionRef}/transcript${buildQuery(query)}`),
  hints: (chatbotId: string, sessionRef: string) =>
    apiClient.get<HintResponse>(`/chatbots/${chatbotId}/live-sessions/${sessionRef}/hints`),
  // [No.24 코드 리뷰 1회차 M4] 개입 응답은 `watchWindowMissed`(관찰 창 밖 개입 여부)를 더 가진
  // `InterveneHandoffResponse`다 — 종료/전송/인수 응답(`HandoffDetail`)과 스키마가 다르다.
  intervene: (chatbotId: string, sessionRef: string) =>
    apiClient.post<InterveneHandoffResponse>(`/chatbots/${chatbotId}/live-sessions/${sessionRef}/handoff`),

  // 개입 동작 — 전송·종료·인수·마스킹 미리보기 (⑤~⑧)
  sendMessage: (chatbotId: string, handoffId: string, dto: SendAgentMessageDto) =>
    apiClient.post<SendAgentMessageResponse>(`/chatbots/${chatbotId}/handoffs/${handoffId}/messages`, dto),
  end: (chatbotId: string, handoffId: string) => apiClient.post<HandoffDetail>(`/chatbots/${chatbotId}/handoffs/${handoffId}/end`),
  takeover: (chatbotId: string, handoffId: string, dto: TakeoverHandoffDto) =>
    apiClient.post<HandoffDetail>(`/chatbots/${chatbotId}/handoffs/${handoffId}/takeover`, dto),
  maskPreview: (chatbotId: string, dto: MaskPreviewRequestDto) =>
    apiClient.post<MaskPreviewResponse>(`/chatbots/${chatbotId}/handoffs/mask-preview`, dto),

  // 이력·요약 (⑨~⑫)
  historySummary: (chatbotId: string, query: HandoffHistoryQuery) =>
    apiClient.get<HandoffSummaryResponse>(`/chatbots/${chatbotId}/handoffs/summary${buildQuery(query)}`),
  historyList: (chatbotId: string, query: HandoffHistoryQuery) =>
    apiClient.get<Paginated<HandoffHistoryItem>>(`/chatbots/${chatbotId}/handoffs${buildQuery(query)}`),
  historyDetail: (chatbotId: string, handoffId: string) =>
    apiClient.get<HandoffHistoryDetailResponse>(`/chatbots/${chatbotId}/handoffs/${handoffId}`),

  // 상담 연계 설정 (⑱⑲)
  getSettings: (chatbotId: string) => apiClient.get<HandoffSettings>(`/chatbots/${chatbotId}/handoff-settings`),
  updateSettings: (chatbotId: string, dto: UpdateHandoffSettingsDto) =>
    apiClient.put<HandoffSettings>(`/chatbots/${chatbotId}/handoff-settings`, dto),
};
