import { Injectable, Logger } from '@nestjs/common';
import { maskPii } from '@chat-bot/pii-mask';
import { toKstDayBucket } from '@chat-bot/shared-types';
import type { DialogueBundle, Survey, SurveyEvent } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { buildAnsweredRows, buildSkippedRow } from './lib/answer-rows';
import { guardAbandonedEvent, guardCompletedEvent, guardQuestionEvent } from './lib/write-guard';
import type { ResponseRowSnapshot } from './lib/write-guard';

export interface SurveyResponseApplyContext {
  chatbotId: string;
  groupId: string;
  sessionId: string;
  channelType: string;
  conversationLogId?: string;
  now: Date;
  bundle: DialogueBundle;
}

/**
 * ★ 설문 응답 쓰기 유일 파일(No.27, ADR-0035 §4·§8). `surveyResponse`·`surveyAnswer`의
 * `create|createMany|update|updateMany|upsert` 호출은 이 파일에만 있다. `delete*` 0건(S-1).
 * import처는 `conversation/public-conversation.service.ts` 1곳뿐이다(S-6).
 * 예외를 모두 삼킨다(`apply()`는 대화 응답을 실패시키지 않는다, AC-SV3-6). 로그에 응답 값·`sessionId`·
 * 예외 `message`를 남기지 않는다(FR-0-111).
 */
@Injectable()
export class SurveyResponseService {
  private readonly logger = new Logger('SurveyResponseService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bannedWordFilter: BannedWordFilterService,
  ) {}

  async apply(events: readonly SurveyEvent[], ctx: SurveyResponseApplyContext): Promise<void> {
    for (const event of events) {
      try {
        await this.applyOne(event, ctx);
      } catch {
        this.logger.warn(`설문 응답 적재 실패: chatbotId=${ctx.chatbotId} surveyId=${event.attempt.surveyId} kind=${event.kind}`);
      }
    }
  }

  private findSurvey(bundle: DialogueBundle, surveyId: string): Survey | undefined {
    return bundle.surveys?.find((s) => s.id === surveyId);
  }

  private async findRow(ctx: SurveyResponseApplyContext, event: SurveyEvent) {
    return this.prisma.surveyResponse.findUnique({
      where: {
        chatbotId_sessionId_surveyId_startedAt: {
          chatbotId: ctx.chatbotId,
          sessionId: ctx.sessionId,
          surveyId: event.attempt.surveyId,
          startedAt: event.attempt.startedAt,
        },
      },
    });
  }

  private async applyOne(event: SurveyEvent, ctx: SurveyResponseApplyContext): Promise<void> {
    const survey = this.findSurvey(ctx.bundle, event.attempt.surveyId);

    if (event.kind === 'EXPOSED') {
      if (!survey || survey.structureVersion !== event.attempt.structureVersion) return;
      const dayBucket = toKstDayBucket(event.attempt.startedAt);
      const isDuplicate = await this.hasPriorCompletion(ctx.chatbotId, ctx.sessionId, event.attempt.surveyId);
      try {
        await this.prisma.surveyResponse.create({
          data: {
            chatbotId: ctx.chatbotId,
            surveyId: event.attempt.surveyId,
            groupId: ctx.groupId,
            sessionId: ctx.sessionId,
            channelType: ctx.channelType,
            structureVersion: event.attempt.structureVersion,
            startedAt: event.attempt.startedAt,
            status: 'EXPOSED',
            lastInteractedAt: event.attempt.startedAt,
            isDuplicate,
            exposedNodeId: event.nodeId ?? undefined,
            conversationLogId: ctx.conversationLogId,
            dayBucket,
          },
        });
      } catch {
        // 유일 제약 위반 = 리플레이 → 무시(멱등)
      }
      return;
    }

    if (event.kind === 'ANSWERED' || event.kind === 'SKIPPED') {
      const row = await this.findRow(ctx, event);
      const snapshot: ResponseRowSnapshot | null = row
        ? { id: row.id, status: row.status, structureVersion: row.structureVersion, lastQuestionIndex: row.lastQuestionIndex }
        : null;
      const guard = guardQuestionEvent(snapshot, survey, {
        questionKey: event.questionKey,
        questionIndex: event.questionIndex,
        value: event.kind === 'ANSWERED' ? event.value : undefined,
      });
      if (!guard.ok || !row) return;

      const common = {
        surveyId: event.attempt.surveyId,
        questionKey: event.questionKey,
        questionIndex: event.questionIndex,
        dayBucket: row.dayBucket,
        channelType: row.channelType,
        isDuplicate: row.isDuplicate,
        answeredAt: ctx.now,
      };
      let rows;
      if (event.kind === 'ANSWERED') {
        const value =
          event.value.type === 'TEXT'
            ? { ...event.value, text: await this.maskFreeText(event.value.text) }
            : event.value;
        rows = buildAnsweredRows(common, value);
      } else {
        rows = [buildSkippedRow(common)];
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.surveyAnswer.createMany({ data: rows.map((r) => ({ ...r, responseId: row.id })) });
          const updated = await tx.surveyResponse.updateMany({
            where: { id: row.id, lastQuestionIndex: { lt: event.questionIndex }, status: { in: ['EXPOSED', 'IN_PROGRESS'] } },
            data: { status: 'IN_PROGRESS', started: true, lastQuestionIndex: event.questionIndex, lastInteractedAt: ctx.now },
          });
          if (updated.count === 0) throw new Error('OUT_OF_ORDER_RACE');
        });
      } catch {
        // 답 행 유일 제약 위반(리플레이) 또는 순서 경합 — 조용히 무시
      }
      return;
    }

    if (event.kind === 'COMPLETED') {
      const row = await this.findRow(ctx, event);
      const snapshot: ResponseRowSnapshot | null = row
        ? { id: row.id, status: row.status, structureVersion: row.structureVersion, lastQuestionIndex: row.lastQuestionIndex }
        : null;
      const guard = guardCompletedEvent(snapshot, survey);
      if (!guard.ok || !row || !survey) return;

      const requiredKeys = survey.questions.filter((q) => q.required).map((q) => q.key);
      const answeredHeadRows = await this.prisma.surveyAnswer.findMany({
        where: { responseId: row.id, isHead: true, kind: 'ANSWERED' },
        select: { questionKey: true },
      });
      const answeredKeys = new Set(answeredHeadRows.map((r) => r.questionKey));
      const missingRequiredCount = requiredKeys.filter((k) => !answeredKeys.has(k)).length;

      const priorCompleted = await this.hasPriorCompletion(ctx.chatbotId, ctx.sessionId, event.attempt.surveyId, row.id);
      const isDuplicate = row.isDuplicate || priorCompleted;

      await this.prisma.$transaction(async (tx) => {
        await tx.surveyResponse.update({
          where: { id: row.id },
          data: { status: 'COMPLETED', completedAt: ctx.now, lastInteractedAt: ctx.now, missingRequiredCount, isDuplicate },
        });
        if (isDuplicate && !row.isDuplicate) {
          await tx.surveyAnswer.updateMany({ where: { responseId: row.id }, data: { isDuplicate: true } });
        }
      });
      return;
    }

    if (event.kind === 'ABANDONED') {
      const row = await this.findRow(ctx, event);
      const snapshot: ResponseRowSnapshot | null = row
        ? { id: row.id, status: row.status, structureVersion: row.structureVersion, lastQuestionIndex: row.lastQuestionIndex }
        : null;
      const guard = guardAbandonedEvent(snapshot);
      if (!guard.ok || !row) return;

      await this.prisma.surveyResponse.update({
        where: { id: row.id },
        data: { status: 'ABANDONED', endReason: event.reason, endedAt: ctx.now, lastInteractedAt: ctx.now },
      });
    }
  }

  private async hasPriorCompletion(chatbotId: string, sessionId: string, surveyId: string, excludeId?: string): Promise<boolean> {
    const found = await this.prisma.surveyResponse.findFirst({
      where: { chatbotId, sessionId, surveyId, status: 'COMPLETED', ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!found;
  }

  /** `ConversationLogService.record()`와 같은 함수를 같은 순서로 호출한다(금지어 → PII, ADR-0013). */
  private async maskFreeText(text: string): Promise<string> {
    const bannedMasked = await this.bannedWordFilter.maskPlainText(text);
    return maskPii(bannedMasked).maskedText;
  }
}
