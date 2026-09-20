import type { ButtonAction, ChannelType, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';

export interface InboundTurn {
  sessionId: string;
  message?: string;
  buttonAction?: ButtonAction;
  /** 검증 전 원본 — 엔진의 `resolveTurn`(내부 `sanitizeConversationState`)이 항상 재검증한다(FR-10-4). */
  state?: unknown;
}

export interface ChannelMessage {
  outputs: DialogOutput[];
}

/**
 * 채널 어댑터 계약(FR-11-17). 대화 처리 코어는 채널을 모르며, 채널별 차이는 어댑터에서만
 * 흡수한다(개발명세서 §1). 이번 Phase의 구현체는 `WebChannelAdapter` 1종뿐이다(FR-11-18).
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType>;
  normalizeInbound(raw: { sessionId: string; message?: string; buttonAction?: ButtonAction; state?: unknown }): InboundTurn;
  renderOutbound(outputs: DialogOutput[]): ChannelMessage[];
}
