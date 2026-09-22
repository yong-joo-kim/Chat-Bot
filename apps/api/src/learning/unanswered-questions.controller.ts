import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  BulkIgnoreDto,
  BulkIgnoreSchema,
  BulkResolveDto,
  BulkResolveSchema,
  BulkResult,
  DecomposedResolveRequestDto,
  DecomposedResolveRequestSchema,
  DecomposedResolveResult,
  DecompositionResponse,
  Paginated,
  ResolveResult,
  ResolveUnansweredQuestionDto,
  ResolveUnansweredQuestionSchema,
  UnansweredQuestionDetail,
  UnansweredQuestionListItem,
  UnansweredQuestionListQuery,
  UnansweredQuestionListQuerySchema,
  UnansweredQuestionSummary,
} from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { UnansweredQuestionsService } from './unanswered-questions.service';
import { DecompositionService } from './decomposition.service';
import { DecomposedResolveService } from './decomposed-resolve.service';

/**
 * No.15 학습현황 — 미응답 질문 검토 큐(FR-15-9~38). 조회 `dialogue:read` / 반영·무시·재오픈 `dialogue:write`.
 * ⚠ 물리 삭제 경로는 없다(FR-15-29, AC-15B-16) — `Delete`를 import하지 않는다.
 * ⚠ 라우트 선언 순서: `@Get('summary')`를 `@Get(':id')`보다 먼저 선언한다(라우트 함정 주의, §5.1).
 */
@Controller('chatbots/:chatbotId/unanswered-questions')
export class UnansweredQuestionsController {
  constructor(
    private readonly service: UnansweredQuestionsService,
    private readonly decompositionService: DecompositionService,
    private readonly decomposedResolveService: DecomposedResolveService,
  ) {}

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(UnansweredQuestionListQuerySchema)) query: UnansweredQuestionListQuery,
  ): Promise<Paginated<UnansweredQuestionListItem>> {
    return this.service.list(chatbotId, query);
  }

  @Get('summary')
  @RequirePermission('dialogue:read')
  summary(@Param('chatbotId') chatbotId: string): Promise<UnansweredQuestionSummary> {
    return this.service.summary(chatbotId);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  detail(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<UnansweredQuestionDetail> {
    return this.service.detail(chatbotId, id);
  }

  /** No.23 (A) 요소분해 — 조회 시 계산, 저장 없음(FR-L2-6, DD-105). */
  @Get(':id/decomposition')
  @RequirePermission('dialogue:read')
  decomposition(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<DecompositionResponse> {
    return this.decompositionService.decompose(chatbotId, id);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  resolve(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveUnansweredQuestionSchema)) dto: ResolveUnansweredQuestionDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<ResolveResult> {
    return this.service.resolve(chatbotId, id, dto, actor.id);
  }

  @Post(':id/ignore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  ignore(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<UnansweredQuestionListItem> {
    return this.service.ignore(chatbotId, id);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  reopen(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<UnansweredQuestionListItem> {
    return this.service.reopen(chatbotId, id);
  }

  /** No.23 (A) 통합 반영 — 의도 + 엔티티 동시 반영. 기존 `/resolve`는 무회귀로 유지된다(FR-L2-13). */
  @Post(':id/resolve-decomposed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  resolveDecomposed(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecomposedResolveRequestSchema)) dto: DecomposedResolveRequestDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<DecomposedResolveResult> {
    return this.decomposedResolveService.resolve(chatbotId, id, dto, actor.id);
  }

  @Post('bulk-resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  bulkResolve(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(BulkResolveSchema)) dto: BulkResolveDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<BulkResult> {
    return this.service.bulkResolve(chatbotId, dto, actor.id);
  }

  @Post('bulk-ignore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  bulkIgnore(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(BulkIgnoreSchema)) dto: BulkIgnoreDto): Promise<BulkResult> {
    return this.service.bulkIgnore(chatbotId, dto);
  }
}
