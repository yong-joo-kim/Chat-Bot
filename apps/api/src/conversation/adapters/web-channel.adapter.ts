import { Injectable } from '@nestjs/common';
import type { ButtonAction, ChannelType, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';
import { CHANNEL_CAPABILITIES, LEGACY_WEB_WIDGET_OUTPUT_PROFILE, WIDGET_FEATURE_RICH_V1 } from '@chat-bot/shared-types';
import { degradeOutputs } from '../lib/output-degrade';
import type { ChannelAdapter, ChannelMessage, ChannelRenderContext, InboundTurn } from './channel-adapter';

/**
 * 이번 Phase의 유일한 채널 어댑터 구현체(FR-11-18). 지원 타입은 채널 능력표
 * `CHANNEL_CAPABILITIES`에서 **파생**한다(자기 목록 리터럴 0 — C-8 · RM-5).
 * [신규 No.46] `rich-v1`을 선언한 요청만 WEB 프로필(캐러셀 포함)로 렌더하고, 선언이 없으면
 * 구버전 위젯 프로필(`LEGACY_WEB_WIDGET_OUTPUT_PROFILE` — 캐러셀 미지원)로 강등한다.
 */
@Injectable()
export class WebChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'WEB';
  readonly supportedOutputTypes: ReadonlySet<DialogOutputType> = new Set<DialogOutputType>(CHANNEL_CAPABILITIES.WEB.outputs.types);

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

  renderOutbound(outputs: DialogOutput[], ctx?: ChannelRenderContext): ChannelMessage[] {
    const profile = (ctx?.features ?? []).includes(WIDGET_FEATURE_RICH_V1) ? CHANNEL_CAPABILITIES.WEB.outputs : LEGACY_WEB_WIDGET_OUTPUT_PROFILE;
    return [{ outputs: degradeOutputs(outputs, profile) }];
  }
}
