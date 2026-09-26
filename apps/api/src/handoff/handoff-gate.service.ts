import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { WIDGET_FEATURE_HANDOFF_V1 } from '@chat-bot/shared-types';
import type { ConversationState, DialogOutput, PublicHandoffState, PublicMessageResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { openField } from '../common/crypto/field-crypto';
import type { InboundTurn } from '../conversation/adapters/channel-adapter';
import { HandoffThreadService } from './handoff-thread.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { verifyHandoffToken } from './lib/handoff-token';
import { classifyHandoffCase } from './lib/handoff-auth';
import type { HandoffAuthLatest } from './lib/handoff-auth';
import { judgeHandoffExpiry } from './lib/handoff-expiry';
import { clearEnvelopeForHandoff } from './lib/envelope-clear';

const UNVERIFIED_TEXT = '지금은 메시지를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.';
const ENDED_TOKEN_GRACE_MS = 5 * 60_000;

export interface HandoffGateEvaluateInput {
  chatbotId: string;
  sessionId: string;
  now: Date;
  channelOpen: boolean;
  features: readonly string[] | undefined;
  tokenHeader: string | undefined;
  inbound: InboundTurn;
  rawState: unknown;
}

export type HandoffGateResult =
  | { kind: 'PASS'; state: unknown; prependOutputs?: DialogOutput[] }
  | { kind: 'HANDLED'; response: PublicMessageResponse; rawUserMessage: string; botResponseForLog: string };

/**
 * 공개 파이프라인 ②.7 분기(§5) — 입구 금지어 판정 직후·번들·엔진 이전. 상담이 꺼진 챗봇이고
 * 토큰 헤더가 없으면 설정 캐시 조회 1회 후 즉시 `PASS`(추가 DB 조회 0 — FR-0-119 바이트 동일).
 */
@Injectable()
export class HandoffGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsCache: HandoffSettingsCacheService,
    private readonly thread: HandoffThreadService,
    private readonly config: ConfigService,
  ) {}

  /** 응답 `handoff.watch` 부착 판정에 쓰는 가벼운 조회(설정 캐시 재사용, §5.5) — 새 export 없이
   * 이 서비스 1개(`HandoffGateService`)만으로 파이프라인이 필요한 정보를 얻는다. */
  async isHandoffEnabled(chatbotId: string): Promise<boolean> {
    const settings = await this.settingsCache.get(chatbotId);
    return settings.enabled;
  }

  async evaluate(input: HandoffGateEvaluateInput): Promise<HandoffGateResult> {
    const settings = await this.settingsCache.get(input.chatbotId);
    const needLookup = settings.enabled || settings.draining || input.tokenHeader !== undefined;
    if (!needLookup) return { kind: 'PASS', state: input.rawState };

    let latestRow = await this.prisma.handoffSession.findFirst({
      where: { chatbotId: input.chatbotId, sessionId: input.sessionId },
      orderBy: { startedAt: 'desc' },
    });
    if (!latestRow) return { kind: 'PASS', state: input.rawState };

    // G-1 — 조회 시점 시간 종료 판정(§8.4). 판정되면 먼저 종료하고 ENDED로 재분류한다.
    if (latestRow.status !== 'ENDED') {
      const expiryReason = judgeHandoffExpiry(
        {
          status: latestRow.status as 'CONNECTING' | 'CONNECTED',
          startedAt: latestRow.startedAt,
          connectedAt: latestRow.connectedAt,
          lastUserMessageAt: latestRow.lastUserMessageAt,
          lastAgentMessageAt: latestRow.lastAgentMessageAt,
          firstAgentReplyAt: latestRow.firstAgentReplyAt,
        },
        settings,
        input.channelOpen,
        input.now,
      );
      if (expiryReason) {
        await this.thread.endHandoff({
          handoffSessionId: latestRow.id,
          chatbotId: input.chatbotId,
          reason: expiryReason,
          now: input.now,
          settings,
        });
        latestRow = { ...latestRow, status: 'ENDED', endReason: expiryReason, endedAt: input.now };
      }
    }

    const latest: HandoffAuthLatest = {
      status: latestRow.status as HandoffAuthLatest['status'],
      tokenHash: latestRow.tokenHash,
      clientMode: latestRow.clientMode as HandoffAuthLatest['clientMode'],
      endedAt: latestRow.endedAt,
    };
    const hasFeatureFlag = (input.features ?? []).includes(WIDGET_FEATURE_HANDOFF_V1);
    const tokenHeaderPresent = input.tokenHeader !== undefined && input.tokenHeader.length > 0;
    const tokenMatches = tokenHeaderPresent && latest.tokenHash !== null && verifyHandoffToken(input.tokenHeader as string, latest.tokenHash);

    const gateCase = classifyHandoffCase({
      latest,
      hasFeatureFlag,
      tokenHeaderPresent,
      tokenMatches,
      now: input.now,
      endedGraceMs: ENDED_TOKEN_GRACE_MS,
    });

    switch (gateCase) {
      case 'NONE':
        return { kind: 'PASS', state: input.rawState };

      case 'FIRST_CONTACT':
        return this.handleFirstContact(latestRow.id, input, hasFeatureFlag);

      case 'VERIFIED':
        return this.handleVerified(latestRow, input);

      case 'LEGACY_ACTIVE':
        return this.handleLegacyActive(latestRow, input);

      case 'UNVERIFIED':
        await this.thread.incrementUnverified(latestRow.id);
        return {
          kind: 'HANDLED',
          rawUserMessage: resolveHandoffUserText(input.inbound),
          botResponseForLog: UNVERIFIED_TEXT,
          response: {
            messageId: randomUUID(),
            outputs: [{ type: 'TEXT', payload: { text: UNVERIFIED_TEXT } }],
            state: input.rawState as ConversationState,
            stateReset: false,
          },
        };

      case 'ENDED_GRACE':
      case 'ENDED_EXPIRED':
      default: {
        const connectedAt = latestRow.connectedAt ?? latestRow.endedAt ?? latestRow.startedAt;
        const state = clearEnvelopeForHandoff(input.rawState, connectedAt);
        // G-8(§5.3) — 구버전(LEGACY) 상담이 시간 기반으로 종료되면(게이트·폴링·정리 루프 중 누가
        // 먼저 끝냈든) 상담원 메시지·종료 SYSTEM 메시지가 소실된다. 다음 사용자 발화의 봇 출력
        // 앞에 미전달분을 전치하고 커서를 전진시킨다(코드리뷰 1회차 Medium #4).
        if (latestRow.clientMode === 'LEGACY' && latestRow.legacyDeliveredSeq < latestRow.lastSeq) {
          const prependOutputs = await this.collectUndeliveredLegacyOutputs(latestRow.id, latestRow.legacyDeliveredSeq);
          if (prependOutputs.length > 0) return { kind: 'PASS', state, prependOutputs };
        }
        return { kind: 'PASS', state };
      }
    }
  }

  private async handleFirstContact(handoffSessionId: string, input: HandoffGateEvaluateInput, hasFeatureFlag: boolean): Promise<HandoffGateResult> {
    if (hasFeatureFlag) {
      const token = await this.thread.issueModernToken(handoffSessionId, input.now);
      if (!token) {
        // CAS 경합 — 다른 요청이 먼저 발급했다. 미확인 취급.
        await this.thread.incrementUnverified(handoffSessionId);
        return this.unverifiedResult(input);
      }
      const rawUserMessage = resolveHandoffUserText(input.inbound);
      const appended = await this.thread.appendUserMessage({
        handoffSessionId,
        chatbotId: input.chatbotId,
        rawInput: rawUserMessage,
        conversationLogId: null,
        now: input.now,
        rawTextMaxAgeMs: this.rawTextMaxAgeMs(),
      });
      const handoff: PublicHandoffState = { status: 'CONNECTED', token, pollAfterMs: 0 };
      return {
        kind: 'HANDLED',
        rawUserMessage,
        botResponseForLog: '',
        response: {
          messageId: randomUUID(),
          outputs: [],
          state: clearEnvelopeForHandoff(input.rawState, input.now) as ConversationState,
          stateReset: false,
          handoff,
        },
      };
    }

    const legacyOk = await this.thread.markLegacy(handoffSessionId, input.now);
    if (!legacyOk) {
      await this.thread.incrementUnverified(handoffSessionId);
      return this.unverifiedResult(input);
    }
    return this.deliverLegacy(handoffSessionId, input, 0);
  }

  private async handleVerified(
    latestRow: { id: string; chatbotId: string },
    input: HandoffGateEvaluateInput,
  ): Promise<HandoffGateResult> {
    const rawUserMessage = resolveHandoffUserText(input.inbound);
    const appended = await this.thread.appendUserMessage({
      handoffSessionId: latestRow.id,
      chatbotId: input.chatbotId,
      rawInput: rawUserMessage,
      conversationLogId: null,
      now: input.now,
      rawTextMaxAgeMs: this.rawTextMaxAgeMs(),
    });
    void appended;
    const handoff: PublicHandoffState = { status: 'CONNECTED', pollAfterMs: this.config.get<number>('HANDOFF_POLL_INTERVAL_MS') ?? 3000 };
    return {
      kind: 'HANDLED',
      rawUserMessage,
      botResponseForLog: '',
      response: {
        messageId: randomUUID(),
        outputs: [],
        state: clearEnvelopeForHandoff(input.rawState, input.now) as ConversationState,
        stateReset: false,
        handoff,
      },
    };
  }

  private async handleLegacyActive(
    latestRow: { id: string; chatbotId: string; legacyDeliveredSeq: number },
    input: HandoffGateEvaluateInput,
  ): Promise<HandoffGateResult> {
    const rawUserMessage = resolveHandoffUserText(input.inbound);
    await this.thread.appendUserMessage({
      handoffSessionId: latestRow.id,
      chatbotId: input.chatbotId,
      rawInput: rawUserMessage,
      conversationLogId: null,
      now: input.now,
      rawTextMaxAgeMs: this.rawTextMaxAgeMs(),
    });
    const result = await this.deliverLegacy(latestRow.id, input, latestRow.legacyDeliveredSeq);
    if (result.kind === 'HANDLED') return { ...result, rawUserMessage };
    return result;
  }

  /** 구버전 위젯 편승 전달(G-5) — 미전달 `AGENT`·공개 `SYSTEM` 메시지를 `TEXT` 아웃풋으로 담는다. */
  private async deliverLegacy(handoffSessionId: string, input: HandoffGateEvaluateInput, afterSeq: number): Promise<HandoffGateResult> {
    const outputs = await this.collectUndeliveredLegacyOutputs(handoffSessionId, afterSeq);
    return {
      kind: 'HANDLED',
      rawUserMessage: resolveHandoffUserText(input.inbound),
      botResponseForLog: outputs.map((o) => (o.type === 'TEXT' ? o.payload.text : '')).join('\n'),
      response: {
        messageId: randomUUID(),
        outputs,
        state: clearEnvelopeForHandoff(input.rawState, input.now) as ConversationState,
        stateReset: false,
      },
    };
  }

  /** 미전달 `AGENT`·공개 `SYSTEM`(TAKEOVER 제외) 메시지를 `TEXT` 아웃풋으로 모으고 커서를
   * 전진시킨다(G-5·G-8 공용, §5.3). */
  private async collectUndeliveredLegacyOutputs(handoffSessionId: string, afterSeq: number): Promise<DialogOutput[]> {
    const pending = await this.prisma.handoffMessage.findMany({
      where: { handoffSessionId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, sender: true, systemKind: true, text: true },
    });
    const deliverable = pending.filter((m) => m.sender === 'AGENT' || (m.sender === 'SYSTEM' && m.systemKind !== 'TAKEOVER'));
    if (deliverable.length > 0) {
      await this.thread.advanceLegacyCursor(handoffSessionId, deliverable[deliverable.length - 1].seq);
    }
    return deliverable.map((m) => ({ type: 'TEXT', payload: { text: openField('HANDOFF_TEXT', m.id, m.text) ?? '' } }));
  }

  private unverifiedResult(input: HandoffGateEvaluateInput): HandoffGateResult {
    return {
      kind: 'HANDLED',
      rawUserMessage: resolveHandoffUserText(input.inbound),
      botResponseForLog: UNVERIFIED_TEXT,
      response: {
        messageId: randomUUID(),
        outputs: [{ type: 'TEXT', payload: { text: UNVERIFIED_TEXT } }],
        state: input.rawState as ConversationState,
        stateReset: false,
      },
    };
  }

  private rawTextMaxAgeMs(): number {
    return this.config.get<number>('HANDOFF_RAW_TEXT_MAX_AGE_MS') ?? 3_600_000;
  }
}

/** 종료 후 버튼 `NODE`는 실행하지 않고 라벨 텍스트로 사용자 메시지가 된다(FR-CS4-3·EX-CS-9). */
function resolveHandoffUserText(inbound: InboundTurn): string {
  if (inbound.buttonAction?.kind === 'NODE') return `[선택] ${inbound.buttonAction.label ?? '버튼'}`;
  if (inbound.buttonAction?.kind === 'MESSAGE') return inbound.buttonAction.text;
  return inbound.message ?? '';
}
