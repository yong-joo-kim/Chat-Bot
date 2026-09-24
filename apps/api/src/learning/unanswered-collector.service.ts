import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { shouldCollect } from './lib/collect-decision';
import type { InputKind } from './lib/collect-decision';
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
      });
      if (!decision.collect) return;

      const now = new Date();
      const existing = await this.prisma.unansweredQuestion.findUnique({
        where: { chatbotId_questionNormalized: { chatbotId: input.chatbotId, questionNormalized: decision.normalized } },
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

  private async mergeIntoExisting(
    existing: { id: string; variants: string; status: string },
    questionText: string,
    now: Date,
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
      },
    });
  }

  private async createIfUnderLimit(input: CollectUnansweredQuestionParams, normalized: string, now: Date): Promise<void> {
    const maxPending = this.config.get<number>('UNANSWERED_MAX_PENDING') ?? 5000;
    const pendingCount = await this.prisma.unansweredQuestion.count({ where: { chatbotId: input.chatbotId, status: 'PENDING' } });
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
        },
      });
    } catch (e) {
      // 동시 요청이 같은 정규화 키로 첫 create에 몰리면 유니크 위반(P2002) — 1회만 update로 합류한다.
      if (this.isUniqueConstraintViolation(e)) {
        await this.prisma.unansweredQuestion.update({
          where: { chatbotId_questionNormalized: { chatbotId: input.chatbotId, questionNormalized: normalized } },
          data: { occurredCount: { increment: 1 }, lastOccurredAt: now },
        });
        return;
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
