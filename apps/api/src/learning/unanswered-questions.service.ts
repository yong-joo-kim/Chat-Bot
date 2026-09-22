import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { UnansweredQuestion as PrismaUnansweredQuestion } from '@prisma/client';
import type {
  ApiErrorCode,
  BulkFailure,
  BulkIgnoreDto,
  BulkResolveDto,
  BulkResult,
  Paginated,
  ResolveResult,
  ResolveUnansweredQuestionDto,
  UnansweredQuestionDetail,
  UnansweredQuestionListItem,
  UnansweredQuestionListQuery,
  UnansweredQuestionSummary,
} from '@chat-bot/shared-types';
import { LEARNING_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ApiExceptionBody } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { IntentsService } from '../intents/intents.service';
import { LearningApplyService } from './learning-apply.service';
import { toUnansweredQuestionListItem, parseVariantsJson } from './unanswered-question.mapper';
import { suggestIntents } from './lib/intent-suggest';
import type { SuggestCandidateIntent } from './lib/intent-suggest';
import { foldTrend, trendStartDayBucket } from './lib/occurrence-trend';
import { ClassifierPredictService } from '../classifier/classifier-predict.service';
import type { IntentSuggestion } from '@chat-bot/shared-types';

const NOT_FOUND_MESSAGE = '요청하신 미응답 질문을 찾을 수 없습니다.';
const ALREADY_PROCESSED_MESSAGE = '이미 처리된 항목입니다. 되돌리기(재오픈) 후 다시 시도해 주세요.';
/** EX-15-9 — 의도 수 × (예문 수+1)이 이 상한을 넘으면 추천 계산을 생략한다(N+1 아닌 CPU 비용 방어). */
const SUGGESTION_CANDIDATE_LIMIT = 20000;

@Injectable()
export class UnansweredQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly intentsService: IntentsService,
    private readonly learningApply: LearningApplyService,
    private readonly config: ConfigService,
    private readonly classifierPredict: ClassifierPredictService,
  ) {}

  private async findRowOrThrow(chatbotId: string, id: string): Promise<PrismaUnansweredQuestion> {
    const row = await this.prisma.unansweredQuestion.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  private parseExamplesJson(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  /** 의도 후보 집합을 요청당 1회 로드해 전 행이 공유한다(NFR-P4, N+1 금지). */
  private async loadSuggestionCandidates(chatbotId: string): Promise<SuggestCandidateIntent[]> {
    const intents = await this.prisma.intent.findMany({ where: { chatbotId }, select: { id: true, name: true, examples: true } });
    return intents.map((row) => ({ id: row.id, name: row.name, examples: this.parseExamplesJson(row.examples) }));
  }

  private computeLexicalSuggestions(normalizedQuestion: string, candidates: SuggestCandidateIntent[]): IntentSuggestion[] {
    const candidateSize = candidates.reduce((sum, c) => sum + c.examples.length + 1, 0);
    if (candidateSize > SUGGESTION_CANDIDATE_LIMIT) return [];
    const minScore = this.config.get<number>('INTENT_SUGGEST_MIN_SCORE') ?? LEARNING_LIMITS.suggestMinScore;
    return suggestIntents(normalizedQuestion, candidates, { minScore, max: LEARNING_LIMITS.suggestionsMax }).map((s) => ({
      ...s,
      source: 'LEXICAL' as const,
    }));
  }

  /**
   * 추천 산출 우선순위(FR-L2-27, ADR-0027 §12.4): ① 분류기가 `READY`이고 stale이 아니면 확률
   * (`source:'CLASSIFIER'`) ② 아니면 기존 bigram(`source:'LEXICAL'`). **둘을 섞지 않는다.**
   * `classifierPredict.predictBatch()`가 `null`을 반환하면(비활성·미학습·`MODEL_CHANGED`·임베딩 실패)
   * 요청 전체가 조용히 ②로 폴백한다(AC-L2-15, 오류가 아니라 폴백).
   */
  private async resolveSuggestions(
    chatbotId: string,
    rows: PrismaUnansweredQuestion[],
    candidates: SuggestCandidateIntent[],
  ): Promise<Map<string, IntentSuggestion[]>> {
    const pending = rows.filter((r) => r.status === 'PENDING');
    const result = new Map<string, IntentSuggestion[]>();
    if (pending.length === 0) return result;

    let classifierMap: Map<string, { intentId: string; intentName: string; score: number }[]> | null = null;
    try {
      classifierMap = await this.classifierPredict.predictBatch(
        chatbotId,
        pending.map((r) => ({ id: r.id, text: r.questionText })),
      );
    } catch {
      classifierMap = null; // 분류기 호출 실패도 폴백으로 수렴한다(오류를 전파하지 않는다).
    }

    for (const row of pending) {
      if (classifierMap) {
        const predictions = classifierMap.get(row.id) ?? [];
        result.set(
          row.id,
          predictions.map((p) => ({ intentId: p.intentId, intentName: p.intentName, score: p.score, matchedExample: p.intentName, source: 'CLASSIFIER' as const })),
        );
      } else {
        result.set(row.id, this.computeLexicalSuggestions(row.questionNormalized, candidates));
      }
    }
    return result;
  }

  async list(chatbotId: string, query: UnansweredQuestionListQuery): Promise<Paginated<UnansweredQuestionListItem>> {
    await this.scope.assertReadable(chatbotId);

    const statusFilter = query.status && query.status.length > 0 ? query.status : ['PENDING'];
    const where: Prisma.UnansweredQuestionWhereInput = {
      chatbotId,
      status: { in: statusFilter },
      ...(query.q ? { questionText: { contains: query.q } } : {}),
      ...(query.recurredOnly ? { recurredCount: { gt: 0 } } : {}),
      ...(query.from || query.to
        ? { lastOccurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    // FR-15-11 — 기본 정렬 occurredCount desc → 동률 시 lastOccurredAt desc. DB(orderBy)가 결정한다.
    const orderBy: Prisma.UnansweredQuestionOrderByWithRelationInput[] =
      query.sort === 'occurredCount' ? [{ occurredCount: query.order }, { lastOccurredAt: 'desc' }] : [{ [query.sort]: query.order }];

    const [rows, total] = await Promise.all([
      this.prisma.unansweredQuestion.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.unansweredQuestion.count({ where }),
    ]);

    const candidates = await this.loadSuggestionCandidates(chatbotId);
    const intentNameById = new Map(candidates.map((c) => [c.id, c.name]));
    // 질의 임베딩은 목록 요청당 배치 1회(FR-L2-30, AC-L2-14) — 행별 호출을 하지 않는다.
    const suggestionsById = await this.resolveSuggestions(chatbotId, rows, candidates);

    const items = rows.map((row) =>
      toUnansweredQuestionListItem(row, {
        resolvedIntentName: row.resolvedIntentId ? intentNameById.get(row.resolvedIntentId) : undefined,
        // RESOLVED/IGNORED 항목은 추천이 화면에서 쓰이지 않는다 — 계산을 건너뛰어 목록 성능을 지킨다.
        suggestions: suggestionsById.get(row.id) ?? [],
      }),
    );

    return toPaginated(items, total, query.page, query.pageSize);
  }

  /** FR-15-14 — 탭 배지·대시보드 위젯 전용 경량 API. 목록 전체를 불러오지 않는다. */
  async summary(chatbotId: string): Promise<UnansweredQuestionSummary> {
    await this.scope.assertReadable(chatbotId);
    const maxPending = this.config.get<number>('UNANSWERED_MAX_PENDING') ?? LEARNING_LIMITS.maxPendingPerChatbot;
    const pendingCount = await this.prisma.unansweredQuestion.count({ where: { chatbotId, status: 'PENDING' } });
    return { pendingCount, limitReached: pendingCount >= maxPending };
  }

  async detail(chatbotId: string, id: string): Promise<UnansweredQuestionDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, id);

    const candidates = await this.loadSuggestionCandidates(chatbotId);
    const intentNameById = new Map(candidates.map((c) => [c.id, c.name]));
    const suggestionsById = await this.resolveSuggestions(chatbotId, [row], candidates);
    const suggestions = suggestionsById.get(row.id) ?? [];

    const variants = parseVariantsJson(row.variants);
    const trendDays = LEARNING_LIMITS.trendDays;
    const now = new Date();

    let trend: Array<{ dayBucket: string; count: number }> = foldTrend([], trendDays, now);
    if (variants.length > 0) {
      const fromBucket = trendStartDayBucket(trendDays, now);
      const trendRows = await this.prisma.conversationLog.groupBy({
        by: ['dayBucket'],
        where: { chatbotId, userMessage: { in: variants }, dayBucket: { gte: fromBucket } },
        _count: { _all: true },
      });
      trend = foldTrend(
        trendRows.map((r) => ({ dayBucket: r.dayBucket, count: r._count._all })),
        trendDays,
        now,
      );
    }

    const item = toUnansweredQuestionListItem(row, {
      resolvedIntentName: row.resolvedIntentId ? intentNameById.get(row.resolvedIntentId) : undefined,
      suggestions,
    });

    return {
      ...item,
      variants,
      trend,
      // 변형이 5건 상한에 닿아 있으면 더 있었을 수 있다 — 발생 추이가 근사임을 알린다(DD-67).
      trendApproximated: variants.length >= LEARNING_LIMITS.variantsMax,
    };
  }

  /**
   * 반영 단건 처리(FR-15-20~26, DD-62/63). 반환값 `intentId`는 일괄 처리에서 `applyLearning()` 호출
   * 대상 목록을 모으는 데 쓰인다. `appliedImmediately`는 호출부가 `applyLearning()` 실행 후 채운다.
   */
  private async resolveOne(
    chatbotId: string,
    id: string,
    dto: { intentId?: string; intentName?: string; exampleText?: string },
    actorId: string | null,
    auditSummary: string,
  ): Promise<{ result: ResolveResult; intentId: string }> {
    const question = await this.findRowOrThrow(chatbotId, id);
    if (question.status !== 'PENDING') {
      throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
    }

    const exampleText = dto.exampleText ?? question.questionText;

    // ① 예문 반영(DD-62) — 번들 무효화는 ③에서 1회만 수행하도록 미룬다.
    const applied = await this.intentsService.applyLearningExample(
      chatbotId,
      { intentId: dto.intentId, intentName: dto.intentName },
      exampleText,
      { auditSummary, deferBundleInvalidate: true },
    );

    // ② 상태 전이 — 조건부 updateMany(CAS, DD-63). `findFirst` 후 `update` 패턴을 쓰지 않는다.
    const now = new Date();
    const transition = await this.prisma.unansweredQuestion.updateMany({
      where: { id, chatbotId, status: 'PENDING' },
      data: { status: 'RESOLVED', resolvedIntentId: applied.intentId, resolvedAt: now, resolvedById: actorId },
    });
    if (transition.count === 0) {
      throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
    }

    return {
      intentId: applied.intentId,
      result: {
        questionId: id,
        intentId: applied.intentId,
        intentName: applied.intentName,
        created: applied.created,
        exampleCount: applied.exampleCount,
        linkedNodeCount: applied.linkedNodeCount,
        conflicts: applied.conflicts,
        appliedImmediately: false, // ③에서 applyLearning() 결과로 덮어쓴다(K-4).
      },
    };
  }

  async resolve(chatbotId: string, id: string, dto: ResolveUnansweredQuestionDto, actorId: string | null): Promise<ResolveResult> {
    await this.scope.assertWritable(chatbotId); // ARCHIVED → 409(C-1)
    const { result, intentId } = await this.resolveOne(chatbotId, id, dto, actorId, '학습현황 반영 (미응답 1건)');

    // ③ applyLearning(DD-55, K-2) — 요청당 정확히 1회.
    const applyResult = await this.learningApply.applyLearning({
      chatbotId,
      intentIds: [intentId],
      reason: 'UNANSWERED_RESOLVE',
      resolvedCount: 1,
    });
    result.appliedImmediately = applyResult.appliedImmediately;
    return result;
  }

  async ignore(chatbotId: string, id: string): Promise<UnansweredQuestionListItem> {
    await this.scope.assertWritable(chatbotId);
    await this.findRowOrThrow(chatbotId, id);
    const transition = await this.prisma.unansweredQuestion.updateMany({
      where: { id, chatbotId, status: 'PENDING' },
      data: { status: 'IGNORED' },
    });
    if (transition.count === 0) throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
    const row = await this.findRowOrThrow(chatbotId, id);
    return toUnansweredQuestionListItem(row);
  }

  async reopen(chatbotId: string, id: string): Promise<UnansweredQuestionListItem> {
    await this.scope.assertWritable(chatbotId);
    await this.findRowOrThrow(chatbotId, id);
    // FR-15-28 — 반영으로 추가된 예문은 되돌리지 않는다. resolvedIntentId/resolvedAt도 지우지 않는다(이력 보존).
    const transition = await this.prisma.unansweredQuestion.updateMany({
      where: { id, chatbotId, status: { in: ['RESOLVED', 'IGNORED'] } },
      data: { status: 'PENDING' },
    });
    if (transition.count === 0) throw new ApiException('ALREADY_RESOLVED', 409, '이미 대기 상태인 항목입니다.');
    const row = await this.findRowOrThrow(chatbotId, id);
    return toUnansweredQuestionListItem(row);
  }

  async bulkResolve(chatbotId: string, dto: BulkResolveDto, actorId: string | null): Promise<BulkResult> {
    await this.scope.assertWritable(chatbotId);
    this.assertBulkSizeOrThrow(dto.items.length);

    const results: ResolveResult[] = [];
    const failed: BulkFailure[] = [];
    const succeededIntentIds: string[] = [];

    for (const item of dto.items) {
      try {
        const { result, intentId } = await this.resolveOne(
          chatbotId,
          item.id,
          { intentId: item.intentId, intentName: item.intentName, exampleText: item.exampleText },
          actorId,
          `학습현황 일괄 반영 (미응답 ${dto.items.length}건)`,
        );
        results.push(result);
        succeededIntentIds.push(intentId);
      } catch (e) {
        failed.push(this.toBulkFailure(item.id, e));
      }
    }

    // ③ applyLearning은 성공 건이 있을 때 챗봇당 1회만 호출한다(FR-15-33, K-2, AC-15B-12).
    if (succeededIntentIds.length > 0) {
      const applyResult = await this.learningApply.applyLearning({
        chatbotId,
        intentIds: succeededIntentIds,
        reason: 'UNANSWERED_BULK_RESOLVE',
        resolvedCount: succeededIntentIds.length,
      });
      for (const result of results) result.appliedImmediately = applyResult.appliedImmediately;
    }

    return { succeeded: results.length, results, failed };
  }

  async bulkIgnore(chatbotId: string, dto: BulkIgnoreDto): Promise<BulkResult> {
    await this.scope.assertWritable(chatbotId);
    this.assertBulkSizeOrThrow(dto.ids.length);

    const failed: BulkFailure[] = [];
    let succeeded = 0;
    for (const id of dto.ids) {
      try {
        await this.findRowOrThrow(chatbotId, id);
        const transition = await this.prisma.unansweredQuestion.updateMany({
          where: { id, chatbotId, status: 'PENDING' },
          data: { status: 'IGNORED' },
        });
        if (transition.count === 0) throw new ApiException('ALREADY_RESOLVED', 409, ALREADY_PROCESSED_MESSAGE);
        succeeded += 1;
      } catch (e) {
        failed.push(this.toBulkFailure(id, e));
      }
    }
    // 무시는 대화 자산을 바꾸지 않으므로 applyLearning()을 호출하지 않는다(K-1 — 호출 지점은 반영뿐).
    return { succeeded, results: [], failed };
  }

  private assertBulkSizeOrThrow(count: number): void {
    const maxItems = this.config.get<number>('LEARNING_BULK_MAX_ITEMS') ?? LEARNING_LIMITS.bulkMaxItems;
    if (count > maxItems) {
      throw new ApiException('BULK_SIZE_EXCEEDED', 400, `일괄 처리는 한 번에 최대 ${maxItems}건까지 가능합니다(현재 ${count}건).`);
    }
  }

  private toBulkFailure(id: string, e: unknown): BulkFailure {
    if (e instanceof ApiException) {
      const body = e.getResponse() as ApiExceptionBody;
      return { id, code: body.code as ApiErrorCode, message: body.message };
    }
    const message = e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.';
    return { id, code: 'INTERNAL_ERROR', message };
  }
}
