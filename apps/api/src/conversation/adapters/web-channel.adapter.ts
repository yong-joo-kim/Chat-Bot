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

  normalizeInbound(raw: { sessionId: string; message?: string; buttonAction?: ButtonAction; state?: unknown }): InboundTurn {
    return { sessionId: raw.sessionId, message: raw.message, buttonAction: raw.buttonAction, state: raw.state };
  }

  renderOutbound(outputs: DialogOutput[]): ChannelMessage[] {
    return [{ outputs: degradeOutputs(outputs, this.supportedOutputTypes) }];
  }
}
