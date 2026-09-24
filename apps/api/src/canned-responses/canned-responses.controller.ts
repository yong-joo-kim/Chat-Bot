import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  CannedResponse,
  CreateCannedResponseDto,
  CreateCannedResponseSchema,
  MoveCannedResponseDto,
  MoveCannedResponseSchema,
  UpdateCannedResponseDto,
  UpdateCannedResponseSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CannedResponsesService } from './canned-responses.service';

/** 자주 쓰는 문장 관리 API(P-11, §17.1 ⑬~⑰) — 대화 자산 편집 권한(`dialogue:*`)으로 관리한다. */
@Controller('chatbots/:chatbotId/canned-responses')
export class CannedResponsesController {
  constructor(private readonly service: CannedResponsesService) {}

  @Get()
  @RequirePermission('dialogue:read')
  list(@Param('chatbotId') chatbotId: string): Promise<CannedResponse[]> {
    return this.service.list(chatbotId);
  }

  @Post()
  @RequirePermission('dialogue:write')
  create(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(CreateCannedResponseSchema)) dto: CreateCannedResponseDto): Promise<CannedResponse> {
    return this.service.create(chatbotId, dto);
  }

  @Patch(':cannedId')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('cannedId') cannedId: string,
    @Body(new ZodValidationPipe(UpdateCannedResponseSchema)) dto: UpdateCannedResponseDto,
  ): Promise<CannedResponse> {
    return this.service.update(chatbotId, cannedId, dto);
  }

  @Delete(':cannedId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  remove(@Param('chatbotId') chatbotId: string, @Param('cannedId') cannedId: string): Promise<void> {
    return this.service.remove(chatbotId, cannedId);
  }

  @Post(':cannedId/move')
  @RequirePermission('dialogue:write')
  move(
    @Param('chatbotId') chatbotId: string,
    @Param('cannedId') cannedId: string,
    @Body(new ZodValidationPipe(MoveCannedResponseSchema)) dto: MoveCannedResponseDto,
  ): Promise<{ items: CannedResponse[] }> {
    return this.service.move(chatbotId, cannedId, dto).then((items) => ({ items }));
  }
}
