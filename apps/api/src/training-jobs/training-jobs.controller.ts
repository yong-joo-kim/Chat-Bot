import { Controller, Get, Param } from '@nestjs/common';
import type { TrainingJob } from '@chat-bot/shared-types';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { TrainingJobService } from './training-job.service';
import { toTrainingJobDto } from './training-job.mapper';

/**
 * 챗봇 스코프 작업 상태 폴링 1개(개발명세서 §4 — 전역 `POST /training-jobs`는 만들지 않는다).
 * 교차 챗봇 조회는 `404`(존재 노출 금지, 기존 스코프 규약 재사용).
 */
@Controller('chatbots/:chatbotId/training-jobs')
export class TrainingJobsController {
  constructor(
    private readonly jobs: TrainingJobService,
    private readonly scope: ChatbotScopeService,
  ) {}

  @Get(':id')
  @RequirePermission('dialogue:read')
  async get(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<TrainingJob> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.jobs.getForChatbotOrThrow(chatbotId, id);
    return toTrainingJobDto(row);
  }
}
