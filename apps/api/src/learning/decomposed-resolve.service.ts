import { Injectable } from '@nestjs/common';
import type { ApiErrorCode, DecomposedResolveRequestDto, DecomposedResolveResult, DecompositionSpan } from '@chat-bot/shared-types';
import type { UnansweredQuestion as PrismaUnansweredQuestion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException, ApiExceptionBody } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { IntentsService } from '../intents/intents.service';
import { KeywordsService } from '../keywords/keywords.service';
import { LearningApplyService } from './learning-apply.service';

const NOT_FOUND_MESSAGE = '요청하신 미응답 질문을 찾을 수 없습니다.';
const ALREADY_PROCESSED_MESSAGE = '이미 처리된 항목입니다. 되돌리기(재오픈) 후 다시 시도해 주세요.';

/**
 * No.23 (A) 통합 반영(FR-L2-9~13, DD-104~105) — 의도 + 엔티티를 한 요청으로 처리한다.
 * ★ `IntentsService.applyLearningExample()` 호출 allowlist 3곳 중 하나다(ADR-0025 §13 S-2).
 * 순서: ① 스팬 재검증 → ② 예문 반영(기존 resolve 코어 재사용) → ③ 엔티티 반영(KeywordsService 공용
 * 경로) → ④ 상태 전이(CAS) → ⑤ `applyLearning()` 1회. 트랜잭션으로 묶지 않는다(ADR-0018 §4와 동일 원칙
 * — 결손 방향은 "대화 자산을 잃지 않는 쪽").
 */
@Injectable()
export class DecomposedResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly intentsService: IntentsService,
    private readonly keywordsService: KeywordsService,
    private readonly learningApply: LearningApplyService,
  ) {}

  private async findRowOrThrow(chatbotId: string, id: string): Promise<PrismaUnansweredQuestion> {
    const row = await this.prisma.unansweredQuestion.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  private parseSynonyms(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  /** 원문 범위 이탈·겹침 → `400`, 아무것도 변경되지 않는다(FR-L2-8, AC-L2-4). */
  private assertSpansValid(text: string, spans: readonly DecompositionSpan[]): void {
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    let prevEnd = 0;
    for (const span of sorted) {
      if (span.start < 0 || span.end > text.length || span.start >= span.end) {
        throw new ApiException('VALIDATION_FAILED', 400, '스팬이 원문 범위를 벗어났습니다.');
      }
      if (span.start < prevEnd) {
        throw new ApiException('VALIDATION_FAILED', 400, '스팬이 서로 겹칩니다.');
      }
      prevEnd = span.end;
    }
  }

  private toFailure(id: string, e: unknown): { id: string; code: ApiErrorCode; message: string } {
    if (e instanceof ApiException) {
      const body = e.getResponse() as ApiExceptionBody;
      return { id, code: body.code, message: body.message };
    }
    return { id, code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
  }

  async resolve(chatbotId: string, id: string, dto: DecomposedResolveRequestDto, actorId: string | null): Promise<DecomposedResolveResult> {
    await this.scope.assertWritable(chatbotId);
    const question = await this.findRowOrThrow(chatbotId, id);
    if (question.status !== 'PENDING') {
      throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
    }

    // ① 스팬 재검증 — 실패하면 여기서 끝난다(아무것도 변경되지 않는다).
    if (dto.spans && dto.spans.length > 0) {
      this.assertSpansValid(question.questionText, dto.spans);
    }

    // ② 예문 반영(기존 resolve 코어 100% 재사용 — dedupe·상한 500·충돌·감사·색인 예약은 복제하지 않는다).
    const exampleText = dto.exampleText ?? question.questionText;
    const applied = await this.intentsService.applyLearningExample(
      chatbotId,
      { intentId: dto.intentId, intentName: dto.intentName },
      exampleText,
      { auditSummary: '미응답 요소 반영', deferBundleInvalidate: true },
    );

    // ③ 엔티티 반영(≤10건, 부분 성공 — FR-L2-11) — `KeywordsService`의 기존 경로만 호출한다.
    const entityFailed: { id: string; code: ApiErrorCode; message: string }[] = [];
    const touchedKeywordIds: string[] = [];
    let keywordCount = 0;

    for (let i = 0; i < dto.entities.length; i++) {
      const entity = dto.entities[i];
      const failureId = `entity-${i}`;
      try {
        if (entity.action === 'ADD_SYNONYM') {
          const kw = await this.prisma.keyword.findFirst({ where: { id: entity.keywordId, chatbotId } });
          if (!kw) throw new ApiException('NOT_FOUND', 404, '대상 키워드를 찾을 수 없습니다.');
          const current = this.parseSynonyms(kw.synonyms);
          if (!current.includes(entity.synonym)) {
            await this.keywordsService.update(chatbotId, kw.id, { synonyms: [...current, entity.synonym] });
          }
          touchedKeywordIds.push(kw.id);
        } else {
          const created = await this.keywordsService.create(chatbotId, { name: entity.name as string, synonyms: [entity.synonym] });
          touchedKeywordIds.push(created.id);
        }
        keywordCount += 1;
      } catch (e) {
        entityFailed.push(this.toFailure(failureId, e));
      }
    }

    // ④ 상태 전이(CAS) — `findFirst` 후 `update` 패턴을 쓰지 않는다.
    const now = new Date();
    const transition = await this.prisma.unansweredQuestion.updateMany({
      where: { id, chatbotId, status: 'PENDING' },
      data: { status: 'RESOLVED', resolvedIntentId: applied.intentId, resolvedAt: now, resolvedById: actorId },
    });
    if (transition.count === 0) {
      throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
    }

    const keywordLinkedNodeCount =
      touchedKeywordIds.length > 0
        ? await this.prisma.dialogNodeKeyword.count({ where: { keywordId: { in: touchedKeywordIds } } })
        : 0;

    // ⑤ applyLearning() — 요청당 정확히 1회(K-2).
    const applyResult = await this.learningApply.applyLearning({
      chatbotId,
      intentIds: [applied.intentId],
      reason: 'UNANSWERED_DECOMPOSED_RESOLVE',
      resolvedCount: 1,
    });

    return {
      questionId: id,
      intentId: applied.intentId,
      intentName: applied.intentName,
      created: applied.created,
      exampleCount: applied.exampleCount,
      linkedNodeCount: applied.linkedNodeCount,
      conflicts: applied.conflicts,
      appliedImmediately: applyResult.appliedImmediately,
      keywordCount,
      keywordLinkedNodeCount,
      entityFailed,
    };
  }
}
