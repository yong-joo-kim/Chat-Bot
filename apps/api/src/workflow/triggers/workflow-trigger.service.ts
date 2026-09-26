import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { WORKFLOW_LIMITS } from '@chat-bot/shared-types';
import type { WorkflowOutcome, WorkflowSubscriptionEventType } from '@chat-bot/shared-types';
import type { WorkflowEmission } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../../prisma/prisma.service';
import { computeSessionRef } from '../../handoff/lib/session-ref';
import type { WorkflowSourceEvent, WorkflowEventSink } from '../../common/workflow/workflow-event.port';
import { WorkflowCatalogService } from '../catalog/workflow-catalog.service';
import { WorkflowRunEnqueueWriter } from './workflow-run-enqueue.writer';
import { buildEnvelopeJson, envelopeBytes } from './lib/envelope';
import { processFieldValue } from './lib/field-values';
import { nodeDedupeKey, eventDedupeKey } from './lib/dedupe-key';
import { isSessionLimitExceeded } from './lib/session-limit';
import { computeConsecutiveUnanswered } from './lib/streak';
import { handoffEndedData, handoffStartedData, feedbackNegativeData, surveyCompletedData, unansweredStreakData } from './lib/event-data';

export interface NodeEmissionContext {
  chatbot: { id: string; name: string };
  sessionId: string;
  messageId: string;
  channel: 'WEB';
  servedVersionId: string | null;
  now: Date;
}

/**
 * [신규 No.41] 발송함 적재 서비스(§6) — 순수 포트(`WorkflowEventSink`) 구현 + 노드 방출 적재.
 * 발송·상태 전이는 하지 않는다(그건 `workflow/dispatch`·`workflow/core` 몫). 예외를 던지지 않는다.
 */
@Injectable()
export class WorkflowTriggerService implements WorkflowEventSink {
  private readonly logger = new Logger('WorkflowTriggerService');
  private readonly pending = new Set<Promise<void>>();
  private enqueueFailureCount = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly catalog: WorkflowCatalogService,
    private readonly writer: WorkflowRunEnqueueWriter,
  ) {}

  private enabled(): boolean {
    return this.config.get<boolean>('WORKFLOW_ENABLED') ?? true;
  }

  /** 최근 24시간 적재 실패 근사 계수(R-15) — 인스턴스 로컬(정밀 집계 아님). */
  enqueueFailures24h(): number {
    return this.enqueueFailureCount;
  }

  /** ④.7 — 공개 대화가 await로 호출한다(§6.1). 예외를 던지지 않는다. */
  async enqueueNodeEmissions(emissions: readonly WorkflowEmission[], ctx: NodeEmissionContext): Promise<void> {
    try {
      const limited = emissions.slice(0, WORKFLOW_LIMITS.emissionsPerTurn);
      if (limited.length < emissions.length) {
        this.logger.warn(`WORKFLOW 방출 상한 초과 — chatbotId=${ctx.chatbot.id} count=${emissions.length}`);
      }
      const sessionRef = computeSessionRef(ctx.chatbot.id, ctx.sessionId);

      if (!this.enabled()) {
        for (const emission of limited) {
          await this.writer.enqueue({
            id: randomUUID(),
            targetId: emission.targetId,
            targetName: emission.targetId,
            chatbotId: ctx.chatbot.id,
            triggerKind: 'NODE',
            eventType: 'NODE_ACTION',
            actionKey: emission.actionKey,
            nodeId: emission.nodeId,
            outputIndex: emission.outputIndex,
            messageId: ctx.messageId,
            dedupeKey: nodeDedupeKey(ctx.messageId, emission.nodeId, emission.outputIndex),
            sessionRef,
            servedVersionId: ctx.servedVersionId,
            status: 'SKIPPED',
            statusReason: 'FEATURE_DISABLED',
            personalDataMasked: false,
            fieldNames: [],
            now: ctx.now,
          });
        }
        return;
      }

      const targets = await this.catalog.findForEnqueue(limited.map((e) => e.targetId));
      const sessionLimit = this.config.get<number>('WORKFLOW_SESSION_LIMIT') ?? 3;
      const sessionWindowMin = this.config.get<number>('WORKFLOW_SESSION_WINDOW_MIN') ?? 10;
      const payloadMaxBytes = this.config.get<number>('WORKFLOW_PAYLOAD_MAX_BYTES') ?? 16384;

      for (const emission of limited) {
        const target = targets.get(emission.targetId);
        const dedupeKey = nodeDedupeKey(ctx.messageId, emission.nodeId, emission.outputIndex);
        const base = {
          id: randomUUID(),
          targetId: emission.targetId,
          targetName: target?.name ?? emission.targetId,
          chatbotId: ctx.chatbot.id,
          triggerKind: 'NODE' as const,
          eventType: 'NODE_ACTION' as const,
          actionKey: emission.actionKey,
          nodeId: emission.nodeId,
          outputIndex: emission.outputIndex,
          messageId: ctx.messageId,
          dedupeKey,
          sessionRef,
          servedVersionId: ctx.servedVersionId,
          now: ctx.now,
        };

        if (!target || !target.enabled) {
          await this.writer.enqueue({
            ...base,
            status: 'SKIPPED',
            statusReason: 'TARGET_UNAVAILABLE',
            personalDataMasked: false,
            fieldNames: emission.fields.map((f) => f.name),
          });
          continue;
        }
        if (emission.bindingMissing) {
          await this.writer.enqueue({ ...base, status: 'SKIPPED', statusReason: 'BINDING_MISSING', personalDataMasked: false, fieldNames: [] });
          continue;
        }
        if (!target.secretsOk) {
          await this.writer.enqueue({
            ...base,
            status: 'SKIPPED',
            statusReason: 'TARGET_UNAVAILABLE',
            personalDataMasked: false,
            fieldNames: emission.fields.map((f) => f.name),
          });
          continue;
        }

        const since = new Date(ctx.now.getTime() - sessionWindowMin * 60_000);
        const countInWindow = await this.prisma.workflowRun.count({
          where: { targetId: emission.targetId, sessionRef, triggerKind: 'NODE', status: { not: 'SKIPPED' }, createdAt: { gte: since } },
        });
        if (isSessionLimitExceeded(countInWindow, sessionLimit)) {
          await this.writer.enqueue({
            ...base,
            status: 'SKIPPED',
            statusReason: 'RATE_LIMITED',
            personalDataMasked: false,
            fieldNames: emission.fields.map((f) => f.name),
          });
          continue;
        }

        const processed = emission.fields.map((f) => processFieldValue(f.name, f.value, f.source, target.allowRawPersonalData));
        const personalDataMasked = processed.some((p) => p.masked);
        const fieldsRecord: Record<string, string> = {};
        for (const p of processed) fieldsRecord[p.name] = p.value;

        const envelopeJson = buildEnvelopeJson({
          deliveryId: base.id,
          eventType: 'NODE_ACTION',
          occurredAt: ctx.now,
          test: false,
          chatbot: { id: ctx.chatbot.id, name: ctx.chatbot.name },
          channel: ctx.channel,
          sessionRef,
          source: { messageId: ctx.messageId, nodeId: emission.nodeId, outputIndex: emission.outputIndex },
          action: { key: emission.actionKey },
          fields: fieldsRecord,
        });

        if (envelopeBytes(envelopeJson) > payloadMaxBytes) {
          await this.writer.enqueue({
            ...base,
            status: 'SKIPPED',
            statusReason: 'PAYLOAD_TOO_LARGE',
            personalDataMasked,
            fieldNames: processed.map((p) => p.name),
          });
          continue;
        }

        const paused = target.paused;
        await this.writer.enqueue({
          ...base,
          status: paused ? 'HELD' : 'PENDING',
          statusReason: null,
          holdReason: paused ? 'TARGET' : null,
          heldAt: paused ? ctx.now : null,
          nextAttemptAt: paused ? null : ctx.now,
          personalDataMasked,
          fieldNames: processed.map((p) => p.name),
          payloadJson: envelopeJson,
        });
      }
    } catch {
      this.logger.warn(`WORKFLOW 노드 방출 적재 중 예외: chatbotId=${ctx.chatbot.id}`);
      this.enqueueFailureCount += 1;
    }
  }

  /** 포트 구현 — 동기 반환·예외 없음(§6.2). 내부에서 비동기 적재한다. */
  emit(event: WorkflowSourceEvent): void {
    const p = this.handleEvent(event).catch(() => {
      this.enqueueFailureCount += 1;
      this.logger.warn(`WORKFLOW 이벤트 적재 실패: kind=${event.kind}`);
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** ⚠ 이름에 `ForTest` — 운영 코드 호출 0(W-15). 통합 시험이 fire-and-forget 적재를 기다린다. */
  async drainForTest(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async handleEvent(event: WorkflowSourceEvent): Promise<void> {
    if (!this.enabled()) return;

    if (event.kind === 'TURN_LOGGED') return this.handleTurnLogged(event);

    const eventType = event.kind as WorkflowSubscriptionEventType;
    const subs = await this.catalog.getSubscriptions(event.chatbotId, eventType, event.occurredAt);
    if (subs.length === 0) return;

    if (event.kind === 'HANDOFF_STARTED') {
      const data = handoffStartedData({
        handoffId: event.handoffId,
        alertLevelAtStart: event.alertLevelAtStart,
        consecutiveUnansweredAtStart: event.consecutiveUnansweredAtStart,
      });
      for (const sub of subs) {
        await this.enqueueEvent(sub, {
          chatbotId: event.chatbotId,
          eventType: 'HANDOFF_STARTED',
          sourceRefId: event.handoffId,
          sourceKey: event.handoffId,
          sessionRef: event.sessionRef,
          channel: event.channelType === 'WEB' ? 'WEB' : null,
          occurredAt: event.occurredAt,
          source: { handoffId: event.handoffId, subscriptionId: sub.id },
          data,
        });
      }
      return;
    }

    if (event.kind === 'HANDOFF_ENDED') {
      const row = await this.prisma.handoffSession.findUnique({
        where: { id: event.handoffId },
        select: { sessionRef: true, channelType: true, userMessageCount: true, agentMessageCount: true, startedAt: true, endedAt: true, firstAgentReplyAt: true },
      });
      if (!row) return;
      const durationSeconds = row.endedAt ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)) : 0;
      const firstResponseSeconds = row.firstAgentReplyAt ? Math.max(0, Math.round((row.firstAgentReplyAt.getTime() - row.startedAt.getTime()) / 1000)) : null;
      const data = handoffEndedData({
        handoffId: event.handoffId,
        endReason: event.reason,
        userMessageCount: row.userMessageCount,
        agentMessageCount: row.agentMessageCount,
        firstResponseSeconds,
        durationSeconds,
      });
      for (const sub of subs) {
        await this.enqueueEvent(sub, {
          chatbotId: event.chatbotId,
          eventType: 'HANDOFF_ENDED',
          sourceRefId: event.handoffId,
          sourceKey: event.handoffId,
          sessionRef: row.sessionRef,
          channel: row.channelType === 'WEB' ? 'WEB' : null,
          occurredAt: event.occurredAt,
          source: { handoffId: event.handoffId, subscriptionId: sub.id },
          data,
        });
      }
      return;
    }

    if (event.kind === 'SURVEY_COMPLETED') {
      const sessionRef = computeSessionRef(event.chatbotId, event.sessionId);
      const needsAnswers = subs.some((s) => s.conditions.includeStructuredAnswers);
      let answers: Array<{ questionKey: string; choiceKeys?: string[]; score?: number }> | undefined;
      if (needsAnswers) {
        // 선택·척도 문항만(자유 텍스트 문항 제외, §6.5) — 다중 선택은 문항당 여러 행(choiceKey별)이라
        // 문항 단위로 모은다.
        const rows = await this.prisma.surveyAnswer.findMany({
          where: { responseId: event.responseId, kind: 'ANSWERED' },
          select: { questionKey: true, choiceKey: true, numericValue: true },
        });
        const grouped = new Map<string, { choiceKeys: string[]; score?: number }>();
        for (const r of rows) {
          if (!r.choiceKey && r.numericValue === null) continue; // 자유 텍스트 전용 행
          const g = grouped.get(r.questionKey) ?? { choiceKeys: [] };
          if (r.choiceKey) g.choiceKeys.push(r.choiceKey);
          if (r.numericValue !== null) g.score = r.numericValue;
          grouped.set(r.questionKey, g);
        }
        answers = [...grouped.entries()].map(([questionKey, v]) => ({
          questionKey,
          ...(v.choiceKeys.length > 0 ? { choiceKeys: v.choiceKeys } : {}),
          ...(v.score !== undefined ? { score: v.score } : {}),
        }));
      }
      for (const sub of subs) {
        const data = surveyCompletedData({
          surveyId: event.surveyId,
          surveyName: event.surveyName,
          responseId: event.responseId,
          isDuplicate: event.isDuplicate,
          missingRequiredCount: event.missingRequiredCount,
          ...(sub.conditions.includeStructuredAnswers ? { answers: answers ?? [] } : {}),
        });
        await this.enqueueEvent(sub, {
          chatbotId: event.chatbotId,
          eventType: 'SURVEY_COMPLETED',
          sourceRefId: event.responseId,
          sourceKey: event.responseId,
          sessionRef,
          channel: event.channelType === 'WEB' ? 'WEB' : null,
          occurredAt: event.occurredAt,
          source: { surveyResponseId: event.responseId, subscriptionId: sub.id },
          data,
        });
      }
      return;
    }

    if (event.kind === 'FEEDBACK_NEGATIVE') {
      const sessionRef = computeSessionRef(event.chatbotId, event.sessionId);
      const data = feedbackNegativeData({
        feedbackId: event.feedbackId,
        messageId: event.messageId,
        targetKind: event.targetKind,
        targetId: event.targetId,
        answeredByRag: event.answeredByRag,
      });
      for (const sub of subs) {
        await this.enqueueEvent(sub, {
          chatbotId: event.chatbotId,
          eventType: 'FEEDBACK_NEGATIVE',
          sourceRefId: event.feedbackId,
          sourceKey: event.feedbackId,
          sessionRef,
          channel: event.channelType === 'WEB' ? 'WEB' : null,
          occurredAt: event.occurredAt,
          source: { messageId: event.messageId, feedbackId: event.feedbackId, subscriptionId: sub.id },
          data,
        });
      }
    }
  }

  private async handleTurnLogged(event: Extract<WorkflowSourceEvent, { kind: 'TURN_LOGGED' }>): Promise<void> {
    const subs = await this.catalog.getSubscriptions(event.chatbotId, 'UNANSWERED_STREAK', event.occurredAt);
    if (subs.length === 0) return;
    if (event.blockedByFilter || event.surveyTurn || event.handoffTurn || event.isAnswered) return;

    const rowsDesc = await this.prisma.conversationLog.findMany({
      where: { chatbotId: event.chatbotId, sessionId: event.sessionId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { isAnswered: true, blockedByFilter: true, surveyTurn: true, handoffTurn: true, apiNotice: true },
    });
    const streakCount = computeConsecutiveUnanswered(rowsDesc);
    const sessionRef = computeSessionRef(event.chatbotId, event.sessionId);

    for (const sub of subs) {
      const threshold = sub.conditions.threshold ?? 3;
      if (streakCount < threshold) continue;
      const data = unansweredStreakData({
        streakCount,
        threshold,
        lastMessageId: event.messageId ?? null,
        lastReason: event.apiNotice ? 'API_NOTICE' : 'FALLBACK',
      });
      await this.enqueueEvent(sub, {
        chatbotId: event.chatbotId,
        eventType: 'UNANSWERED_STREAK',
        sourceRefId: sessionRef,
        sourceKey: sessionRef,
        sessionRef,
        channel: event.channelType === 'WEB' ? 'WEB' : null,
        occurredAt: event.occurredAt,
        source: { subscriptionId: sub.id },
        data,
      });
    }
  }

  private async enqueueEvent(
    sub: { id: string; targetId: string; targetName: string; targetEnabled: boolean; targetPaused: boolean; chatbotName: string },
    input: {
      chatbotId: string;
      eventType: Exclude<WorkflowSubscriptionEventType, never>;
      sourceRefId: string;
      sourceKey: string;
      sessionRef: string | null;
      channel: 'WEB' | null;
      occurredAt: Date;
      source: Parameters<typeof buildEnvelopeJson>[0]['source'];
      data: Parameters<typeof buildEnvelopeJson>[0]['data'];
    },
  ): Promise<void> {
    const dedupeKey = eventDedupeKey(sub.id, input.sourceKey);
    const id = randomUUID();

    if (!sub.targetEnabled) {
      await this.writer.enqueue({
        id,
        targetId: sub.targetId,
        targetName: sub.targetName,
        chatbotId: input.chatbotId,
        triggerKind: 'EVENT',
        eventType: input.eventType,
        subscriptionId: sub.id,
        sourceRefId: input.sourceRefId,
        dedupeKey,
        sessionRef: input.sessionRef,
        status: 'SKIPPED',
        statusReason: 'TARGET_UNAVAILABLE',
        personalDataMasked: false,
        fieldNames: [],
        now: input.occurredAt,
      });
      return;
    }

    const payloadMaxBytes = this.config.get<number>('WORKFLOW_PAYLOAD_MAX_BYTES') ?? 16384;
    // [코드 리뷰 R1 H-1] 구독 기반 이벤트도 노드 방출과 같은 봉투 계약을 지킨다 — chatbot이 항상 null로
    // 나가던 문제를 캐시가 1쿼리로 같이 적재한 챗봇 이름으로 채운다(§6.3).
    const envelopeJson = buildEnvelopeJson({
      deliveryId: id,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      test: false,
      chatbot: { id: input.chatbotId, name: sub.chatbotName },
      channel: input.channel,
      sessionRef: input.sessionRef,
      source: input.source,
      data: input.data,
    });

    if (envelopeBytes(envelopeJson) > payloadMaxBytes) {
      await this.writer.enqueue({
        id,
        targetId: sub.targetId,
        targetName: sub.targetName,
        chatbotId: input.chatbotId,
        triggerKind: 'EVENT',
        eventType: input.eventType,
        subscriptionId: sub.id,
        sourceRefId: input.sourceRefId,
        dedupeKey,
        sessionRef: input.sessionRef,
        status: 'SKIPPED',
        statusReason: 'PAYLOAD_TOO_LARGE',
        personalDataMasked: false,
        fieldNames: [],
        now: input.occurredAt,
      });
      return;
    }

    const paused = sub.targetPaused;
    await this.writer.enqueue({
      id,
      targetId: sub.targetId,
      targetName: sub.targetName,
      chatbotId: input.chatbotId,
      triggerKind: 'EVENT',
      eventType: input.eventType,
      subscriptionId: sub.id,
      sourceRefId: input.sourceRefId,
      dedupeKey,
      sessionRef: input.sessionRef,
      status: paused ? 'HELD' : 'PENDING',
      holdReason: paused ? 'SUBSCRIPTION' : null,
      heldAt: paused ? input.occurredAt : null,
      nextAttemptAt: paused ? null : input.occurredAt,
      personalDataMasked: false,
      fieldNames: [],
      payloadJson: envelopeJson,
      now: input.occurredAt,
    });
  }
}

/** 테스트 발송(§13.5)에서도 재사용하는 간이 결과 코드 매핑 — 순수. */
export function isSuccessOutcome(outcome: WorkflowOutcome | null): boolean {
  return outcome === 'SUCCESS';
}
