import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { IntentClassifierStatus, IntentClassifierTrainResponse } from '@chat-bot/shared-types';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ClassifierTrainingService } from './classifier-training.service';
import { ClassifierPredictService } from './classifier-predict.service';

/** No.23 (B) 경량 의도 분류기 API(설계서 §15.1 #8~9). `dialogue:write`/`dialogue:read` 재사용(신규 권한 0종). */
@Controller('chatbots/:chatbotId/intent-classifier')
export class ClassifierController {
  constructor(
    private readonly trainingService: ClassifierTrainingService,
    private readonly predictService: ClassifierPredictService,
    private readonly scope: ChatbotScopeService,
  ) {}

  @Post('train')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('dialogue:write')
  train(@Param('chatbotId') chatbotId: string): Promise<IntentClassifierTrainResponse> {
    return this.trainingService.train(chatbotId);
  }

  @Get('status')
  @RequirePermission('dialogue:read')
  async status(@Param('chatbotId') chatbotId: string): Promise<IntentClassifierStatus> {
    await this.scope.assertReadable(chatbotId);
    return this.predictService.getStatus(chatbotId);
  }
}
