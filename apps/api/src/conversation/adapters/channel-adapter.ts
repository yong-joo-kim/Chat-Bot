import type { ButtonAction, ChannelType, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';

/**
 * [신규 No.42] 판별 유니온(ADR-0042 §5.2 · R-1) — 2차 외부 채널은 플랫폼이 보증한 사용자 키를
 * 같은 필드로 싣는다(`{ scheme: 'PLATFORM_USER'; … }` 예정). 검증은 어댑터가 아니라 식별
 * 서비스가 한다(비밀 접근 1파일).
 */
export type InboundIdentity = { scheme: 'HOST_SIGNED_TOKEN'; token: string };

export interface InboundTurn {
  sessionId: string;
  message?: string;
  buttonAction?: ButtonAction;
  /** 검증 전 원본 — 엔진의 `resolveTurn`(내부 `sanitizeConversationState`)이 항상 재검증한다(FR-10-4). */
  state?: unknown;
  /** [신규 No.42] 헤더가 없으면 키 자체가 없다(바이트 동일 — AC-OC1-1). */
  identity?: InboundIdentity;
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
  normalizeInbound(raw: { sessionId: string; message?: string; buttonAction?: ButtonAction; state?: unknown; identityToken?: string }): InboundTurn;
  renderOutbound(outputs: DialogOutput[]): ChannelMessage[];
}
