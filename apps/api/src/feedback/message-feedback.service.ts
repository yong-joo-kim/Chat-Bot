import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessageFeedback as PrismaMessageFeedback } from '@prisma/client';
import { FEEDBACK_LIMITS, classifyFeedbackTarget } from '@chat-bot/shared-types';
import type { FeedbackRating } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { UnansweredCollectorService } from '../learning/unanswered-collector.service';
import { isUuid } from '../conversation/lib/is-uuid';
import { decideFeedbackWrite } from './lib/feedback-write-decision';
import { verifyFeedbackTarget } from './lib/feedback-verify';
import { WORKFLOW_EVENT_SINK } from '../common/workflow/workflow-event.port';
import type { WorkflowEventSink } from '../common/workflow/workflow-event.port';

const NOT_FOUND_MESSAGE = '지금은 의견을 받을 수 없어요.';
const CLOSED_MESSAGE = '더 이상 바꿀 수 없어요.';

type LogRow = {
  id: string;
  chatbotId: string;
  sessionId: string | null;
  feedbackOffered: boolean;
  createdAt: Date;
  dayBucket: string;
  groupId: string;
  channelType: string;
  isAnswered: boolean;
  answeredByRag: boolean;
  apiNotice: boolean;
  inputKind: string | null;
  matchedIntentId: string | null;
  matchedFaqId: string | null;
  matchedNodeId: string | null;
  topicId: string | null;
  userMessage: string;
};

type AttemptOutcome = { kind: 'OK'; row: PrismaMessageFeedback | null } | { kind: 'CLOSED' } | { kind: 'RETRY' };

/**
 * 평가 원장 쓰기 유일 파일(F-2, FR-0-141). 결합 검증(로그 PK 1회 조회) → 저장/변경(CAS) → 선점
 * 상태 기계로 큐 편입까지 담당한다(ADR-0038 §2·§3·§9.4). `MessageFeedbackService.submit()`은
 * `PublicFeedbackService`에서만 호출된다(공개 진입 1곳).
 */
@Injectable()
export class MessageFeedbackService {
  private readonly logger = new Logger('MessageFeedbackService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly collector: UnansweredCollectorService,
    @Optional() @Inject(WORKFLOW_EVENT_SINK) private readonly workflowEvents?: WorkflowEventSink,
  ) {}

  async submit(input: { chatbotId: string; messageId: string; sessionId: string; rating: FeedbackRating }): Promise<{ rating: FeedbackRating }> {
    if (!isUuid(input.messageId)) {
      throw new ApiException('FEEDBACK_TARGET_NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    }

    // ⑤ 로그 PK 1회 조회 — 어느 분기든 정확히 1회(§7.2).
    const logRow = await this.prisma.conversationLog.findUnique({
      where: { id: input.messageId },
      select: {
        id: true,
        chatbotId: true,
        sessionId: true,
        feedbackOffered: true,
        createdAt: true,
        dayBucket: true,
        groupId: true,
        channelType: true,
        isAnswered: true,
        answeredByRag: true,
        apiNotice: true,
        inputKind: true,
        matchedIntentId: true,
        matchedFaqId: true,
        matchedNodeId: true,
        topicId: true,
        userMessage: true,
      },
    });

    if (!logRow || !verifyFeedbackTarget(logRow, { chatbotId: input.chatbotId, sessionId: input.sessionId })) {
      // debug 수준 — chatbotId + 결과 코드만(messageId는 앞 8자리). sessionId 전체값 0(NFR-FBS4).
      this.logger.debug(`평가 결합 검증 실패: chatbotId=${input.chatbotId} messageId=${input.messageId.slice(0, 8)}`);
      throw new ApiException('FEEDBACK_TARGET_NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    }
    const log: LogRow = logRow;

    const windowHours = this.config.get<number>('FEEDBACK_CHANGE_WINDOW_HOURS') ?? FEEDBACK_LIMITS.changeWindowHours;
    const maxChanges = this.config.get<number>('FEEDBACK_MAX_CHANGES') ?? FEEDBACK_LIMITS.maxChanges;

    let attempt = await this.attemptWrite(log, input.rating, windowHours, maxChanges);
    if (attempt.kind === 'RETRY') {
      attempt = await this.attemptWrite(log, input.rating, windowHours, maxChanges);
    }
    if (attempt.kind === 'CLOSED') {
      throw new ApiException('FEEDBACK_CLOSED', 409, CLOSED_MESSAGE);
    }
    if (attempt.kind === 'RETRY') {
      // 드묾 — 연속 경합. 안전한 쪽(닫힘)으로 수렴한다(§7.3).
      throw new ApiException('FEEDBACK_CLOSED', 409, CLOSED_MESSAGE);
    }

    // ④ 큐 기여 — 최종값이 DOWN이고 queueOutcome이 null인 요청만 선점한다(선점 상태 기계, §9.4).
    // 편입은 평가 요청 **안에서 await**한다(FR-FB6-6) — 응답 전에 큐가 보여야 시험이 결정적이다.
    if (attempt.row && attempt.row.rating === 'DOWN' && attempt.row.queueOutcome == null) {
      await this.claimAndEnqueue(attempt.row.id, log);
    }

    return { rating: input.rating };
  }

  private async attemptWrite(log: LogRow, requested: FeedbackRating, windowHours: number, maxChanges: number): Promise<AttemptOutcome> {
    const existing = await this.prisma.messageFeedback.findUnique({ where: { conversationLogId: log.id } });
    const now = new Date();

    const decision = decideFeedbackWrite({
      existing: existing ? { rating: existing.rating as FeedbackRating, changeCount: existing.changeCount } : null,
      requested,
      turnCreatedAt: log.createdAt,
      now,
      windowHours,
      maxChanges,
    });

    if (decision === 'CLOSED') return { kind: 'CLOSED' };
    if (decision === 'NOOP') return { kind: 'OK', row: existing };

    if (decision === 'CREATE') {
      const classified = classifyFeedbackTarget(log);
      try {
        const created = await this.prisma.messageFeedback.create({
          data: {
            chatbotId: log.chatbotId,
            conversationLogId: log.id,
            rating: requested,
            changeCount: 0,
            groupId: log.groupId,
            turnDayBucket: log.dayBucket,
            turnCreatedAt: log.createdAt,
            channelType: log.channelType,
            isAnswered: log.isAnswered,
            answeredByRag: log.answeredByRag,
            apiNotice: log.apiNotice,
            inputKind: log.inputKind,
            matchedIntentId: log.matchedIntentId,
            matchedFaqId: log.matchedFaqId,
            matchedNodeId: log.matchedNodeId,
            topicId: log.topicId,
            targetKind: classified.kind,
            targetId: classified.id,
          },
        });
        return { kind: 'OK', row: created };
      } catch (e) {
        if (this.isUniqueConstraintViolation(e)) return { kind: 'RETRY' };
        throw e;
      }
    }

    // CHANGE — CAS(`changeCount`+`rating` 일치할 때만).
    const updateResult = await this.prisma.messageFeedback.updateMany({
      where: { id: existing!.id, changeCount: existing!.changeCount, rating: existing!.rating },
      data: { rating: requested, changeCount: { increment: 1 } },
    });
    if (updateResult.count === 0) return { kind: 'RETRY' };
    const updated = await this.prisma.messageFeedback.findUnique({ where: { conversationLogId: log.id } });
    return { kind: 'OK', row: updated };
  }

  /**
   * 선점 상태 기계(§9.4) — `updateMany where queueOutcome IS NULL`로 성공한 요청만 수집기를 호출한다.
   * 수집 실패는 흡수한다(평가 응답은 `200`, `queueOutcome = FAILED`) — 재시도하지 않는다.
   */
  private async claimAndEnqueue(feedbackId: string, log: LogRow): Promise<void> {
    const claim = await this.prisma.messageFeedback.updateMany({
      where: { id: feedbackId, queueOutcome: null },
      data: { queueOutcome: 'CLAIMED' },
    });
    if (claim.count === 0) return; // 다른 요청이 이미 선점했다.

    // [신규 No.41] 큐 선점 CAS 성공 직후·수집기 호출 전(수집 실패와 무관, §6.2) — F-2·F-15 쓰기 불변.
    this.workflowEvents?.emit({
      kind: 'FEEDBACK_NEGATIVE',
      chatbotId: log.chatbotId,
      sessionId: log.sessionId ?? '',
      channelType: log.channelType,
      feedbackId,
      messageId: log.id,
      targetKind: classifyFeedbackTarget(log).kind,
      targetId: classifyFeedbackTarget(log).id,
      answeredByRag: log.answeredByRag,
      occurredAt: new Date(),
    });

    try {
      const result = await this.collector.collectNegativeFeedback({
        chatbotId: log.chatbotId,
        channelType: log.channelType,
        questionText: log.userMessage,
        isAnswered: log.isAnswered,
        apiNotice: log.apiNotice,
        inputKind: log.inputKind,
        conversationLogId: log.id,
      });

      if (result.kind === 'QUEUED') {
        await this.prisma.messageFeedback.update({
          where: { id: feedbackId },
          data: { queueOutcome: 'QUEUED', queuedAt: new Date(), queueItemId: result.id },
        });
      } else if (result.kind === 'SKIPPED') {
        await this.prisma.messageFeedback.update({
          where: { id: feedbackId },
          data: { queueOutcome: 'SKIPPED', queueSkipCode: result.code },
        });
      } else {
        await this.prisma.messageFeedback.update({ where: { id: feedbackId }, data: { queueOutcome: 'FAILED' } });
      }
    } catch {
      // 경고 로그 = chatbotId + 오류 코드(본문·예외 message 0, §9.4).
      this.logger.warn(`부정 평가 큐 편입 중 예상치 못한 예외: chatbotId=${log.chatbotId}`);
      await this.prisma.messageFeedback.update({ where: { id: feedbackId }, data: { queueOutcome: 'FAILED' } }).catch(() => {});
    }
  }

  private isUniqueConstraintViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }
}
