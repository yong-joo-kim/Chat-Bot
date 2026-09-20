import { apiClient } from './client';
import type { CompareRequestDto, CompareResponse, SimulateRequestDto, SimulateResponse } from '@chat-bot/shared-types';

/**
 * No.10 응답 테스트/시뮬레이션(관리자 전용, 읽기 전용 — FR-0-21).
 * `quality-channel-설계.md` §5.4: `POST /chatbots/:chatbotId/simulate`, `/simulate/compare`.
 */
export const simulationApi = {
  simulate: (chatbotId: string, dto: SimulateRequestDto) =>
    apiClient.post<SimulateResponse>(`/chatbots/${chatbotId}/simulate`, dto),
  compare: (chatbotId: string, dto: CompareRequestDto) =>
    apiClient.post<CompareResponse>(`/chatbots/${chatbotId}/simulate/compare`, dto),
};
