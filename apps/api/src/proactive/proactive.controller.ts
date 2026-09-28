import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import {
  MoveProactiveRuleSchema,
  ProactiveRuleInputSchema,
  ProactiveSettingsInputSchema,
  ProactiveStatsQuerySchema,
} from '@chat-bot/shared-types';
import type {
  MoveProactiveRuleDto,
  ProactiveOverviewResponse,
  ProactiveRuleInput,
  ProactiveRuleView,
  ProactiveSettingsInput,
  ProactiveStatsQuery,
  ProactiveStatsResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { ProactiveSettingsService } from './proactive-settings.service';
import type { ProactiveSettingsView } from './proactive-settings.service';
import { ProactiveRulesService } from './proactive-rules.service';
import { ProactiveOverviewService } from './proactive-overview.service';

/**
 * [신규 No.35] 선제 안내 관리 API(§9.1) — 조회 `channel:read` · 변경 `channel:write`(신규 권한 0,
 * 인사말과 같은 등급). 총 10 핸들러. 신규 `ApiErrorCode` 0종.
 */
@Controller('chatbots/:chatbotId/proactive')
export class ProactiveController {
  constructor(
    private readonly settings: ProactiveSettingsService,
    private readonly rules: ProactiveRulesService,
    private readonly overview: ProactiveOverviewService,
  ) {}

  @Get()
  @RequirePermission('channel:read')
  getOverview(@Param('chatbotId') chatbotId: string): Promise<ProactiveOverviewResponse> {
    return this.overview.getOverview(chatbotId);
  }

  @Put('settings')
  @RequirePermission('channel:write')
  updateSettings(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ProactiveSettingsInputSchema)) dto: ProactiveSettingsInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ProactiveSettingsView> {
    return this.settings.update(chatbotId, dto, user.id);
  }

  @Post('rules')
  @RequirePermission('channel:write')
  @HttpCode(HttpStatus.CREATED)
  createRule(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ProactiveRuleInputSchema)) dto: ProactiveRuleInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ProactiveRuleView> {
    return this.rules.create(chatbotId, dto, user.id);
  }

  @Get('rules/:ruleId')
  @RequirePermission('channel:read')
  getRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<ProactiveRuleView> {
    return this.overview.getRule(chatbotId, ruleId);
  }

  @Put('rules/:ruleId')
  @RequirePermission('channel:write')
  updateRule(
    @Param('chatbotId') chatbotId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(ProactiveRuleInputSchema)) dto: ProactiveRuleInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ProactiveRuleView> {
    return this.rules.update(chatbotId, ruleId, dto, user.id);
  }

  @Delete('rules/:ruleId')
  @RequirePermission('channel:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<void> {
    return this.rules.remove(chatbotId, ruleId);
  }

  @Post('rules/:ruleId/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channel:write')
  enableRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<ProactiveRuleView> {
    return this.rules.enable(chatbotId, ruleId);
  }

  @Post('rules/:ruleId/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channel:write')
  disableRule(@Param('chatbotId') chatbotId: string, @Param('ruleId') ruleId: string): Promise<ProactiveRuleView> {
    return this.rules.disable(chatbotId, ruleId);
  }

  @Post('rules/:ruleId/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channel:write')
  moveRule(
    @Param('chatbotId') chatbotId: string,
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(MoveProactiveRuleSchema)) dto: MoveProactiveRuleDto,
  ): Promise<ProactiveRuleView[]> {
    return this.rules.move(chatbotId, ruleId, dto);
  }

  @Get('stats')
  @RequirePermission('channel:read')
  getStats(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(ProactiveStatsQuerySchema)) query: ProactiveStatsQuery,
  ): Promise<ProactiveStatsResponse> {
    return this.overview.getStats(chatbotId, query);
  }
}
