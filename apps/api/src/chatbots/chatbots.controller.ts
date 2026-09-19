import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  Chatbot,
  ChatbotListItem,
  ChatbotListQuery,
  ChatbotListQuerySchema,
  CopyChatbotDto,
  CopyChatbotSchema,
  CreateChatbotDto,
  CreateChatbotSchema,
  EmbedCode,
  MoveChatbotGroupDto,
  MoveChatbotGroupSchema,
  Paginated,
  PermanentDeleteChatbotDto,
  PermanentDeleteChatbotSchema,
  SlugAvailability,
  SlugAvailabilityQuery,
  SlugAvailabilityQuerySchema,
  UpdateChatbotSettingsDto,
  UpdateChatbotSettingsSchema,
  UpdateChatbotSkinDto,
  UpdateChatbotSkinSchema,
  UpdateChatbotStatusDto,
  UpdateChatbotStatusSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChatbotsService } from './chatbots.service';
import { EmbedCodeService } from './embed-code.service';

// NOTE: `GET /slug-available`은 `GET /:id`보다 먼저 선언해야 한다(설계서 §5.2 라우트 선언 순서 주의).
@UseGuards(PermissionGuard)
@Controller('chatbots')
export class ChatbotsController {
  constructor(
    private readonly chatbotsService: ChatbotsService,
    private readonly embedCodeService: EmbedCodeService,
  ) {}

  @Post()
  @RequirePermission('chatbot:write')
  create(@Body(new ZodValidationPipe(CreateChatbotSchema)) dto: CreateChatbotDto): Promise<Chatbot> {
    return this.chatbotsService.create(dto);
  }

  @Get()
  @RequirePermission('chatbot:read')
  list(@Query(new ZodQueryPipe(ChatbotListQuerySchema)) query: ChatbotListQuery): Promise<Paginated<ChatbotListItem>> {
    return this.chatbotsService.list(query);
  }

  @Get('slug-available')
  @RequirePermission('chatbot:read')
  checkSlugAvailability(
    @Query(new ZodQueryPipe(SlugAvailabilityQuerySchema)) query: SlugAvailabilityQuery,
  ): Promise<SlugAvailability> {
    return this.chatbotsService.checkSlugAvailability(query);
  }

  @Get(':id')
  @RequirePermission('chatbot:read')
  findOne(@Param('id') id: string): Promise<Chatbot> {
    return this.chatbotsService.findOne(id);
  }

  @Patch(':id/settings')
  @RequirePermission('chatbot:write')
  updateSettings(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatbotSettingsSchema)) dto: UpdateChatbotSettingsDto,
  ): Promise<Chatbot> {
    return this.chatbotsService.updateSettings(id, dto);
  }

  @Patch(':id/skin')
  @RequirePermission('chatbot:write')
  updateSkin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatbotSkinSchema)) dto: UpdateChatbotSkinDto,
  ): Promise<Chatbot> {
    return this.chatbotsService.updateSkin(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('chatbot:write')
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChatbotStatusSchema)) dto: UpdateChatbotStatusDto,
  ): Promise<Chatbot> {
    return this.chatbotsService.updateStatus(id, dto);
  }

  @Patch(':id/group')
  @RequirePermission('chatbot:write')
  moveGroup(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveChatbotGroupSchema)) dto: MoveChatbotGroupDto,
  ): Promise<Chatbot> {
    return this.chatbotsService.moveGroup(id, dto);
  }

  @Post(':id/copy')
  @RequirePermission('chatbot:write')
  copy(@Param('id') id: string, @Body(new ZodValidationPipe(CopyChatbotSchema)) dto: CopyChatbotDto): Promise<Chatbot> {
    return this.chatbotsService.copy(id, dto);
  }

  /** 보관(ARCHIVED) 전환 — 파괴적 영구 삭제가 아니다(FR-1-15(a), D-9 참고). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('chatbot:delete')
  async archive(@Param('id') id: string): Promise<void> {
    await this.chatbotsService.archive(id);
  }

  // ADR-0002: 보관(soft delete)과 영구 삭제를 별도 경로로 분리해 권한도 chatbot:delete/chatbot:purge로 나눈다.
  /** 영구 삭제(FR-1-15(b)). GET으로 노출하지 않는 파괴적 동작이라 별도 POST 경로를 둔다(NFR-S6, D-9). */
  @Post(':id/permanent-delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('chatbot:purge')
  async permanentDelete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PermanentDeleteChatbotSchema)) dto: PermanentDeleteChatbotDto,
  ): Promise<void> {
    await this.chatbotsService.permanentDelete(id, dto);
  }

  @Get(':id/embed-code')
  @RequirePermission('chatbot:read')
  async embedCode(@Param('id') id: string): Promise<EmbedCode> {
    const chatbot = await this.chatbotsService.findOne(id);
    return this.embedCodeService.generate(chatbot.slug);
  }
}
