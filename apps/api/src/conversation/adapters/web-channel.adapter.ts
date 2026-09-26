import { Injectable } from '@nestjs/common';
import type { ButtonAction, ChannelType, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';
import { degradeOutputs } from '../lib/output-degrade';
import type { ChannelAdapter, ChannelMessage, InboundTurn } from './channel-adapter';

/** 이번 Phase의 유일한 채널 어댑터 구현체(FR-11-18). WEB은 12종 중 실행 지원 7종을 전부 지원한다. */
@Injectable()
export class WebChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'WEB';
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType> = new Set<DialogOutputType>([
    'TEXT',
    'CARD',
    'IMAGE',
    'BUTTON',
    'LINK',
    'PAUSE',
    'PHONE_CALL',
  ]);

  normalizeInbound(raw: { sessionId: string; message?: string; buttonAction?: ButtonAction; state?: unknown; identityToken?: string }): InboundTurn {
    // [신규 No.42] identityToken이 있을 때만 키 자체를 만든다 — 없으면 기존 InboundTurn과 키 집합이
    // 같다(바이트 동일, FR-OC1-2).
    return {
      sessionId: raw.sessionId,
      message: raw.message,
      buttonAction: raw.buttonAction,
      state: raw.state,
      ...(typeof raw.identityToken === 'string' && raw.identityToken.length > 0 ? { identity: { scheme: 'HOST_SIGNED_TOKEN' as const, token: raw.identityToken } } : {}),
    };
  }

  renderOutbound(outputs: DialogOutput[]): ChannelMessage[] {
    return [{ outputs: degradeOutputs(outputs, this.supportedOutputTypes) }];
  }
}
