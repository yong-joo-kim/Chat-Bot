import type { ButtonAction, DialogOutput, TraceStep } from '@chat-bot/shared-types';

/** 시뮬레이터 대화 1건(사용자/봇/시스템 안내/오류). SIM1·SIM1-D가 공유한다. */
export interface SimMessage {
  id: string;
  role: 'user' | 'bot' | 'system' | 'error';
  text?: string;
  outputs?: DialogOutput[];
  trace?: TraceStep[];
  matchedNodeName?: string;
  matchedIntentName?: string;
  matchedFaqQuestion?: string;
  overlayApplied?: boolean;
  unsupportedOutputs?: string[];
  /** 오류 말풍선의 "다시 시도"가 재전송할 원본 요청. */
  retryPayload?: { message?: string; buttonAction?: ButtonAction };
}
