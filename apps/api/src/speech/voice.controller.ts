import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { VoiceSettingsInputSchema, VoiceStatsQuerySchema } from '@chat-bot/shared-types';
import type { VoiceOverviewResponse, VoiceSettingsInput, VoiceSettingsView, VoiceStatsQuery, VoiceStatsResponse } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { VoiceSettingsService } from './admin/voice-settings.service';
import { VoiceOverviewService } from './admin/voice-overview.service';

/**
 * [신규 No.32] 음성 관리 API(voice-ai-설계.md §10.1) — 조회 `channel:read` · 변경 `channel:write`(신규 권한 0 — 음성은 위젯 표시·동작 설정이다,
 * FR-0-333 · VO-13). 3 핸들러. 들어보기 API는 없다(FR-VO5-3 — 서버 호출·감사 0).
 */
@Controller('chatbots/:chatbotId/voice')
export class VoiceController {
  constructor(
    private readonly settings: VoiceSettingsService,
    private readonly overview: VoiceOverviewService,
  ) {}

  @Get()
  @RequirePermission('channel:read')
  getOverview(@Param('chatbotId') chatbotId: string): Promise<VoiceOverviewResponse> {
    return this.overview.getOverview(chatbotId);
  }

  @Put()
  @RequirePermission('channel:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(VoiceSettingsInputSchema)) dto: VoiceSettingsInput,
    @CurrentUser() user: SessionUser,
  ): Promise<VoiceSettingsView> {
    return this.settings.update(chatbotId, dto, user.id);
  }

  @Get('stats')
  @RequirePermission('channel:read')
  getStats(@Param('chatbotId') chatbotId: string, @Query(new ZodQueryPipe(VoiceStatsQuerySchema)) query: VoiceStatsQuery): Promise<VoiceStatsResponse> {
    return this.overview.getStats(chatbotId, query);
  }
}
