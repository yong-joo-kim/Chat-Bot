import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  AugmentationAcceptRequestSchema,
  AugmentationAcceptResponse,
  AugmentationCapability,
  AugmentationGenerateRequestSchema,
  AugmentationGenerateResponse,
  AugmentationListQuerySchema,
  AugmentationListResponse,
  AugmentationRejectRequestSchema,
  AugmentationRejectResponse,
  type AugmentationGenerateRequestDto,
  type AugmentationListQuery,
} from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { AugmentationService } from './augmentation.service';
import { AugmentationAcceptService } from './augmentation-accept.service';

/**
 * No.16 예문 증강 API(설계서 §15.1 #1~5). 조회 `dialogue:read` / 생성·승인·거절 `dialogue:write`
 * (신규 권한 0종). `@Public()` 추가 0건.
 */
@Controller('chatbots/:chatbotId')
export class AugmentationController {
  constructor(
    private readonly service: AugmentationService,
    private readonly acceptService: AugmentationAcceptService,
  ) {}

  @Post('intents/:intentId/augmentations')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('dialogue:write')
  generate(
    @Param('chatbotId') chatbotId: string,
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(AugmentationGenerateRequestSchema)) dto: AugmentationGenerateRequestDto,
  ): Promise<AugmentationGenerateResponse> {
    return this.service.generate(chatbotId, intentId, dto);
  }

  @Get('intents/:intentId/augmentations')
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Param('intentId') intentId: string,
    @Query(new ZodQueryPipe(AugmentationListQuerySchema)) query: AugmentationListQuery,
  ): Promise<AugmentationListResponse> {
    return this.service.list(chatbotId, intentId, query);
  }

  @Get('augmentations/capability')
  @RequirePermission('dialogue:read')
  capability(@Param('chatbotId') chatbotId: string): Promise<AugmentationCapability> {
    return this.service.capability(chatbotId);
  }

  @Post('intents/:intentId/augmentations/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  accept(
    @Param('chatbotId') chatbotId: string,
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(AugmentationAcceptRequestSchema)) dto: { suggestionIds: string[] },
  ): Promise<AugmentationAcceptResponse> {
    return this.acceptService.accept(chatbotId, intentId, dto);
  }

  @Post('intents/:intentId/augmentations/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:write')
  reject(
    @Param('chatbotId') chatbotId: string,
    @Param('intentId') intentId: string,
    @Body(new ZodValidationPipe(AugmentationRejectRequestSchema)) dto: { suggestionIds: string[] },
  ): Promise<AugmentationRejectResponse> {
    return this.service.reject(chatbotId, intentId, dto);
  }
}
