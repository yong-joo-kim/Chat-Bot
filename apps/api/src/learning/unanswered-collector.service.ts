import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { shouldCollect, shouldQueueNegativeFeedback } from './lib/collect-decision';
import type { InputKind, NegativeFeedbackSkipCode } from './lib/collect-decision';
import { mergeVariants } from './lib/variants';

export interface CollectUnansweredQuestionParams {
  chatbotId: string;
  channelType: string;
  /** 마스킹 완료 질문 문자열(ADR-0013) — 이 서비스는 마스킹을 하지 않는다. */
  questionText: string;
  isAnswered: boolean;
  blockedByFilter: boolean;
  inputKind: InputKind;
  /** [No.26] 외부 API 고정 문구 턴(§6.1) — 기본 false. */
  apiNotice?: boolean;
  /** [No.27] 설문이 소비한 턴(FR-SV5-8) — 기본 false. */
  surveyTurn?: boolean;
  /** [No.24] 상담 구간(개입 중) 턴(ADR-0036 §1) — 기본 false. */
  handoffTurn?: boolean;
}

/**
 * 미응답 질문 수집 단일 진입점(DD-51, ADR-0019). `prisma.unansweredQuestion`의 **쓰기는 이 파일과
 * `UnansweredQuestionsService`(상태 전이) 2곳뿐**이다(NFR-M3). `ConversationLogService.record()`가
 * INSERT 성공 직후 호출한다 — 이 서비스는 "무엇을 수집할지"를 알지 않고 판정은 `collect-decision.ts`에
 * 위임한다. 전체가 try/catch로 감싸여 있어 **실패해도 대화 응답에 영향을 주지 않는다**(FR-0-37, FR-15-6).
 * 경고 로그에 질문 본문을 넣지 않는다(NFR-S7).
 */
@Injectable()
export class UnansweredCollectorService {
  private readonly logger = new Logger('UnansweredCollectorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async collect(input: CollectUnansweredQuestionParams): Promise<void> {
    try {
      const maxLength = this.config.get<number>('UNANSWERED_MAX_QUESTION_LENGTH') ?? 200;
      const decision = shouldCollect({
        isAnswered: input.isAnswered,
        blockedByFilter: input.blockedByFilter,
        inputKind: input.inputKind,
        questionText: input.questionText,
        maxLength,
        apiNotice: input.apiNotice,
        surveyTurn: input.surveyTurn,
        handoffTurn: input.handoffTurn,
      });
      if (!decision.collect) return;

      const now = new Date();
      // [No.44 — 커밋 ①] 유일 키를 (chatbotId, source, questionNormalized)로 교체한다.
      // 도입 전 행은 전부 source='UNANSWERED'이므로 결과는 동일하다(동작 불변).
      const existing = await this.prisma.unansweredQuestion.findUnique({
        where: { chatbotId_source_questionNormalized: { chatbotId: input.chatbotId, source: 'UNANSWERED', questionNormalized: decision.normalized } },
      });

      if (existing) {
        await this.mergeIntoExisting(existing, input.questionText, now);
        return;
      }

      await this.createIfUnderLimit(input, decision.normalized, now);
    } catch (e) {
      // 경고 로그에도 질문 본문을 넣지 않는다(NFR-S7) — chatbotId + 오류 메시지만.
      const message = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(`UnansweredQuestion 수집 실패: chatbotId=${input.chatbotId} error=${message}`);
    }
  }

  /**
   * [신규 No.44] 👎 확정 시 학습현황 큐에 편입한다(수집기의 두 번째 진입점, ADR-0038 §4).
   * 호출 주체는 `MessageFeedbackService` 1곳뿐이다(F-15). 예외를 던지지 않는다 — 실패는 `FAILED`로
   * 흡수하고 평가 응답은 그대로 `200`이다(§9.4).
   */
  async collectNegativeFeedback(input: {
    chatbotId: string;
    channelType: string;
    /** ConversationLog.userMessage(마스킹본) — 원문 재접촉 0(ADR-0019 §2 근거 유지). */
    questionText: string;
    isAnswered: boolean;
    apiNotice: boolean;
    inputKind: string | null;
    conversationLogId: string;
  }): Promise<{ kind: 'QUEUED'; id: string } | { kind: 'SKIPPED'; code: NegativeFeedbackSkipCode } | { kind: 'FAILED' }> {
    try {
      const maxLength = this.config.get<number>('UNANSWERED_MAX_QUESTION_LENGTH') ?? 200;
      const decision = shouldQueueNegativeFeedback({
        isAnswered: input.isAnswered,
        apiNotice: input.apiNotice,
        inputKind: input.inputKind,
        questionText: input.questionText,
        maxLength,
      });
      if (!decision.queue) return { kind: 'SKIPPED', code: decision.reason };

      const now = new Date();
      const existing = await this.prisma.unansweredQuestion.findUnique({
        where: {
          chatbotId_source_questionNormalized: { chatbotId: input.chatbotId, source: 'NEGATIVE_FEEDBACK', questionNormalized: decision.normalized },
        },
      });

      if (existing) {
        await this.mergeIntoExisting(existing, input.questionText, now, input.conversationLogId);
        return { kind: 'QUEUED', id: existing.id };
      }

      return await this.createNegativeFeedbackIfUnderLimit(input, decision.normalized, now);
    } catch {
      // 경고 로그에 질문 본문·예외 message를 넣지 않는다(NFR-S7·§9.4) — chatbotId만.
      this.logger.warn(`부정 평가 큐 편입 실패: chatbotId=${input.chatbotId}`);
      return { kind: 'FAILED' };
    }
  }

  private async mergeIntoExisting(
    existing: { id: string; variants: string; status: string },
    questionText: string,
    now: Date,
    lastFeedbackLogId?: string,
  ): Promise<void> {
    const variants = mergeVariants(this.parseVariants(existing.variants), questionText);
    await this.prisma.unansweredQuestion.update({
      where: { id: existing.id },
      data: {
        occurredCount: { increment: 1 },
        lastOccurredAt: now,
        variants: JSON.stringify(variants),
        // 상태를 자동으로 되돌리지 않는다(FR-15-5) — RESOLVED/IGNORED 재유입은 재발생만 드러낸다.
        ...(existing.status !== 'PENDING' ? { recurredCount: { increment: 1 }, recurredAfterAt: now } : {}),
        ...(lastFeedbackLogId ? { lastFeedbackLogId } : {}),
      },
    });
  }

  private async createIfUnderLimit(input: CollectUnansweredQuestionParams, normalized: string, now: Date): Promise<void> {
    const maxPending = this.config.get<number>('UNANSWERED_MAX_PENDING') ?? 5000;
    // [No.44 — 커밋 ①] 상한 계수를 source='UNANSWERED'로 한정한다(소스별 상한, 값은 도입 전과 동일).
    const pendingCount = await this.prisma.unansweredQuestion.count({ where: { chatbotId: input.chatbotId, status: 'PENDING', source: 'UNANSWERED' } });
    if (pendingCount >= maxPending) {
      // FR-15-8 — 상한 도달 시 신규 추가만 중단한다(기존 항목 카운트 증가는 계속된다).
      this.logger.warn(`UnansweredQuestion PENDING 상한 도달 — 신규 추가를 건너뜁니다: chatbotId=${input.chatbotId}`);
      return;
    }

    try {
      await this.prisma.unansweredQuestion.create({
        data: {
          chatbotId: input.chatbotId,
          questionText: input.questionText,
          questionNormalized: normalized,
          variants: JSON.stringify([input.questionText.slice(0, 200)]),
          occurredCount: 1,
          lastOccurredAt: now,
          channelType: input.channelType,
          source: 'UNANSWERED',
        },
      });
    } catch (e) {
      // 동시 요청이 같은 정규화 키로 첫 create에 몰리면 유니크 위반(P2002) — 1회만 update로 합류한다.
      if (this.isUniqueConstraintViolation(e)) {
        await this.prisma.unansweredQuestion.update({
          where: {
            chatbotId_source_questionNormalized: { chatbotId: input.chatbotId, source: 'UNANSWERED', questionNormalized: normalized },
          },
          data: { occurredCount: { increment: 1 }, lastOccurredAt: now },
        });
        return;
      }
      throw e;
    }
  }

  private async createNegativeFeedbackIfUnderLimit(
    input: { chatbotId: string; channelType: string; questionText: string; conversationLogId: string },
    normalized: string,
    now: Date,
  ): Promise<{ kind: 'QUEUED'; id: string } | { kind: 'SKIPPED'; code: NegativeFeedbackSkipCode }> {
    const maxPending = this.config.get<number>('FEEDBACK_QUEUE_MAX_PENDING') ?? 2000;
    const pendingCount = await this.prisma.unansweredQuestion.count({
      where: { chatbotId: input.chatbotId, status: 'PENDING', source: 'NEGATIVE_FEEDBACK' },
    });
    if (pendingCount >= maxPending) {
      this.logger.warn(`NEGATIVE_FEEDBACK PENDING 상한 도달 — 신규 추가를 건너뜁니다: chatbotId=${input.chatbotId}`);
      return { kind: 'SKIPPED', code: 'LIMIT_REACHED' };
    }

    try {
      const created = await this.prisma.unansweredQuestion.create({
        data: {
          chatbotId: input.chatbotId,
          questionText: input.questionText,
          questionNormalized: normalized,
          variants: JSON.stringify([input.questionText.slice(0, 200)]),
          occurredCount: 1,
          lastOccurredAt: now,
          channelType: input.channelType,
          source: 'NEGATIVE_FEEDBACK',
          lastFeedbackLogId: input.conversationLogId,
        },
      });
      return { kind: 'QUEUED', id: created.id };
    } catch (e) {
      if (this.isUniqueConstraintViolation(e)) {
        const merged = await this.prisma.unansweredQuestion.update({
          where: {
            chatbotId_source_questionNormalized: { chatbotId: input.chatbotId, source: 'NEGATIVE_FEEDBACK', questionNormalized: normalized },
          },
          data: { occurredCount: { increment: 1 }, lastOccurredAt: now, lastFeedbackLogId: input.conversationLogId },
        });
        return { kind: 'QUEUED', id: merged.id };
      }
      throw e;
    }
  }

  private isUniqueConstraintViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
  }

  private parseVariants(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
