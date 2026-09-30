import type { UtteranceAnalysisCapability } from '@chat-bot/shared-types';
import { MESSAGES } from '../../../constants/messages';

export interface NewAnalysisBlock {
  kind: 'EMBEDDING' | 'FULL' | 'BUSY_CHATBOT' | 'BUSY_SERVER';
  message: string;
}

/**
 * "새 분석"을 막는 서버 상태 사전 판정(§3.4). 우선순위: 문장 분석 서비스 불가 > 보관 가득 > 이 챗봇 진행 중 > 다른 챗봇 진행 중.
 * capability를 못 읽었으면(`null`) 막지 않고 서버 판정(409/503)에 맡긴다.
 */
export function computeNewAnalysisBlock(cap: UtteranceAnalysisCapability | null): NewAnalysisBlock | null {
  if (!cap) return null;
  const msg = MESSAGES.utteranceAnalysis;
  if (!cap.embeddingAvailable) return { kind: 'EMBEDDING', message: msg.embeddingUnavailableBanner };
  if (cap.stored.count >= cap.stored.max) return { kind: 'FULL', message: msg.storeFull(cap.stored.count, cap.stored.max) };
  if (cap.busy.chatbot) return { kind: 'BUSY_CHATBOT', message: msg.busyChatbot };
  if (cap.busy.server) return { kind: 'BUSY_SERVER', message: msg.busyServer };
  return null;
}
