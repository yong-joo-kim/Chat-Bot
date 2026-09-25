import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import {
  DisableEnvironmentSchema,
  EnableEnvironmentSchema,
  EnvironmentHistoryQuerySchema,
  ProdRollbackSchema,
  ProdSwitchPreviewSchema,
  ProdSwitchSchema,
  PromoteToStagingSchema,
  UpdateEnvironmentGateSchema,
} from '@chat-bot/shared-types';
import type {
  DisableEnvironmentDto,
  DisableEnvironmentPreviewResponse,
  EnableEnvironmentDto,
  EnableEnvironmentPreviewResponse,
  EnvironmentGateSettings,
  EnvironmentHistoryQuery,
  EnvironmentStatus,
  EnvironmentSwitchLogItem,
  Paginated,
  ProdRollbackDto,
  ProdSwitchDto,
  ProdSwitchPreviewDto,
  ProdSwitchPreviewResponse,
  ProdSwitchResponse,
  PromoteToStagingDto,
  PromoteToStagingResponse,
  UpdateEnvironmentGateDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { EnvironmentModeService } from './environment-mode.service';
import { StagingPromotionService } from './staging-promotion.service';
import { EnvironmentHistoryService } from './environment-history.service';
import { ProdSwitchService } from './core/prod-switch.service';
import { VersionBundleService } from './serving/version-bundle.service';

/**
 * [신규 No.40] 환경 분리 관리자 API(§19.1) — 11개 핸들러. `@Public()` 0건.
 */
@Controller('chatbots/:chatbotId/environment')
export class EnvironmentController {
  constructor(
    private readonly mode: EnvironmentModeService,
    private readonly promotion: StagingPromotionService,
    private readonly history: EnvironmentHistoryService,
    private readonly prodSwitch: ProdSwitchService,
    private readonly versionBundles: VersionBundleService,
  ) {}

  @Get()
  @RequirePermission('chatbot:read', 'dialogue:read')
  getStatus(@Param('chatbotId') chatbotId: string): Promise<EnvironmentStatus> {
    return this.mode.getStatus(chatbotId);
  }

  @Post('enable/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read', 'dialogue:read')
  enablePreview(@Param('chatbotId') chatbotId: string): Promise<EnableEnvironmentPreviewResponse> {
    return this.mode.enablePreview(chatbotId);
  }

  @Post('enable')
  @RequirePermission('chatbot:deploy')
  async enable(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(EnableEnvironmentSchema)) dto: EnableEnvironmentDto,
  ): Promise<EnvironmentStatus & { heldRestoreSchedules: number }> {
    const result = await this.mode.enable(chatbotId, dto);
    if (result.enabled) this.versionBundles.warm(chatbotId, result.prod.versionId);
    return result;
  }

  @Post('disable/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read', 'dialogue:read')
  disablePreview(@Param('chatbotId') chatbotId: string): Promise<DisableEnvironmentPreviewResponse> {
    return this.mode.disablePreview(chatbotId);
  }

  @Post('disable')
  @RequirePermission('chatbot:deploy')
  disable(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(DisableEnvironmentSchema)) dto: DisableEnvironmentDto,
  ): Promise<EnvironmentStatus & { cancelledSwitchSchedules: number }> {
    return this.mode.disable(chatbotId, dto);
  }

  @Post('staging/promote')
  @RequirePermission('dialogue:write', 'chatbot:write')
  promote(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(PromoteToStagingSchema)) dto: PromoteToStagingDto,
  ): Promise<PromoteToStagingResponse> {
    return this.promotion.promote(chatbotId, dto);
  }

  @Post('prod/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('chatbot:read', 'dialogue:read')
  prodPreview(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ProdSwitchPreviewSchema)) dto: ProdSwitchPreviewDto,
  ): Promise<ProdSwitchPreviewResponse> {
    return this.prodSwitch.preview(chatbotId, dto);
  }

  @Post('prod/switch')
  @RequirePermission('chatbot:deploy')
  async prodSwitchConfirm(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ProdSwitchSchema)) dto: ProdSwitchDto,
  ): Promise<ProdSwitchResponse> {
    const result = await this.prodSwitch.switch(chatbotId, dto, 'SWITCH');
    if (result.outcome === 'APPLIED') this.versionBundles.warm(chatbotId, result.prod.versionId);
    return result;
  }

  @Post('prod/rollback')
  @RequirePermission('chatbot:deploy')
  async prodRollback(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(ProdRollbackSchema)) dto: ProdRollbackDto,
  ): Promise<ProdSwitchResponse> {
    let targetVersionId = dto.targetVersionId;
    if (!targetVersionId) {
      const preview = await this.prodSwitch.preview(chatbotId, { kind: 'ROLLBACK' });
      targetVersionId = preview.target.versionId;
    }
    const result = await this.prodSwitch.switch(chatbotId, { ...dto, targetVersionId }, 'ROLLBACK');
    if (result.outcome === 'APPLIED') this.versionBundles.warm(chatbotId, result.prod.versionId);
    return result;
  }

  @Get('history')
  @RequirePermission('chatbot:read')
  getHistory(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(EnvironmentHistoryQuerySchema)) query: EnvironmentHistoryQuery,
  ): Promise<Paginated<EnvironmentSwitchLogItem>> {
    return this.history.list(chatbotId, query);
  }

  @Put('gate')
  @RequirePermission('chatbot:deploy')
  updateGate(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(UpdateEnvironmentGateSchema)) dto: UpdateEnvironmentGateDto,
  ): Promise<EnvironmentGateSettings> {
    return this.mode.updateGate(chatbotId, dto);
  }
}
