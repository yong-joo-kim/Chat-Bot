import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import {
  CreateGuardrailRuleSchema,
  GuardrailEventListQuerySchema,
  GuardrailOverviewQuerySchema,
  GuardrailTestRequestSchema,
  MoveGuardrailRuleSchema,
  UpdateGuardrailRuleSchema,
  UpdateGuardrailSettingsSchema,
} from '@chat-bot/shared-types';
import type {
  CreateGuardrailRuleDto,
  GuardrailEventItem,
  GuardrailEventListQuery,
  GuardrailOverview,
  GuardrailOverviewQuery,
  GuardrailRule,
  GuardrailRuleListResponse,
  GuardrailRuleSaveResponse,
  GuardrailSettingsResponse,
  GuardrailTestRequest,
  GuardrailTestResponse,
  MoveGuardrailRuleDto,
  Paginated,
  UpdateGuardrailRuleDto,
  UpdateGuardrailSettingsDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { AuditView } from '../audit-logs/access/audit-view.decorator';
import { GuardrailRulesService } from './guardrail-rules.service';
import { GuardrailSettingsService } from './guardrail-settings.service';
import { GuardrailTestService } from './guardrail-test.service';
import { GuardrailOverviewService } from './guardrail-overview.service';

/**
 * [신규 No.36] 안전 가드레일 관리 API(설계서 §13.1) — 조회 `security:read` · 변경 `security:write`(금지어와 같은 ADMIN
 * 등급, P-9). 신규 권한 0 · 13 핸들러. 규칙 오류는 기존 코드(`VALIDATION_FAILED`·`BANNED_WORD_BLOCKED`·
 * `DUPLICATE_NAME`·`LIMIT_EXCEEDED` 등)를 재사용한다 — 신규 `ApiErrorCode` 0.
 */
@Controller('chatbots/:chatbotId/guardrails')
export class GuardrailsController {
  constructor(
    private readonly rules: GuardrailRulesService,
    private readonly settings: GuardrailSettingsService,
    private readonly tester: GuardrailTestService,
    private readonly overview: GuardrailOverviewService,
  ) {}

  @Get('rules')
  @RequirePermission('security:read')
  listRules(@Param('chatbotId') chatbotId: string): Promise<GuardrailRuleListResponse> {
    return this.rules.list(chatbotId);
  }

  @Post('rules')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.CREATED)
  createRule(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateGuardrailRuleSchema)) dto: CreateGuardrailRuleDto,
    @CurrentUser() user: SessionUser,
  ): Promise<GuardrailRuleSaveResponse> {
    return this.rules.create(chatbotId, dto, user);
  }

  @Get('rules/:ruleId')
  @RequirePermission('security:read')
  getRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<GuardrailRule> {
    return this.rules.get(chatbotId, ruleId);
  }

  @Put('rules/:ruleId')
  @RequirePermission('security:write')
  updateRule(
    @Param('chatbotId') chatbotId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(UpdateGuardrailRuleSchema)) dto: UpdateGuardrailRuleDto,
    @CurrentUser() user: SessionUser,
  ): Promise<GuardrailRuleSaveResponse> {
    return this.rules.update(chatbotId, ruleId, dto, user);
  }

  @Delete('rules/:ruleId')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<void> {
    return this.rules.remove(chatbotId, ruleId);
  }

  @Post('rules/:ruleId/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security:write')
  enableRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string, @CurrentUser() user: SessionUser): Promise<GuardrailRule> {
    return this.rules.setEnabled(chatbotId, ruleId, true, user);
  }

  @Post('rules/:ruleId/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security:write')
  disableRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string, @CurrentUser() user: SessionUser): Promise<GuardrailRule> {
    return this.rules.setEnabled(chatbotId, ruleId, false, user);
  }

  @Post('rules/:ruleId/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security:write')
  moveRule(
    @Param('chatbotId') chatbotId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(MoveGuardrailRuleSchema)) dto: MoveGuardrailRuleDto,
  ): Promise<GuardrailRule[]> {
    return this.rules.move(chatbotId, ruleId, dto);
  }

  /** 저장 0 · 감사 0 · 이벤트 0 — 그래서 POST지만 `security:read`로 충분하다. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security:read')
  test(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(GuardrailTestRequestSchema)) dto: GuardrailTestRequest): Promise<GuardrailTestResponse> {
    return this.tester.test(chatbotId, dto);
  }

  @Get('settings')
  @RequirePermission('security:read')
  getSettings(@Param('chatbotId') chatbotId: string): Promise<GuardrailSettingsResponse> {
    return this.settings.get(chatbotId);
  }

  @Put('settings')
  @RequirePermission('security:write')
  updateSettings(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(UpdateGuardrailSettingsSchema)) dto: UpdateGuardrailSettingsDto,
    @CurrentUser() user: SessionUser,
  ): Promise<GuardrailSettingsResponse> {
    return this.settings.update(chatbotId, dto, user);
  }

  @Get('overview')
  @RequirePermission('security:read')
  getOverview(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(GuardrailOverviewQuerySchema)) query: GuardrailOverviewQuery): Promise<GuardrailOverview> {
    return this.overview.getOverview(chatbotId, query);
  }

  /** 대화 마스킹본을 함께 싣는다 — 거버넌스 모드에서 `VIEW` 감사(열람 감사 닫힌 목록 12 → 13). */
  @Get('events')
  @RequirePermission('security:read')
  @AuditView({ targetType: 'ConversationLog', chatbotParam: 'chatbotId' })
  listEvents(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(GuardrailEventListQuerySchema)) query: GuardrailEventListQuery): Promise<Paginated<GuardrailEventItem>> {
    return this.overview.listEvents(chatbotId, query);
  }
}
