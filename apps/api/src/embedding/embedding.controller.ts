import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { EmbeddingIndexStatus } from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { EmbeddingStatusService } from './index/embedding-status.service';
import { ReindexQueueService } from './index/reindex-queue.service';

/** 1단계 색인 상태·재색인 API(FR-N1-22/23, §10.1). */
@Controller('chatbots/:chatbotId/embeddings')
export class EmbeddingController {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly statusService: EmbeddingStatusService,
    private readonly reindexQueue: ReindexQueueService,
  ) {}

  @Get('status')
  @RequirePermission('chatbot:read')
  async status(@Param('chatbotId') chatbotId: string): Promise<EmbeddingIndexStatus> {
    await this.scope.assertReadable(chatbotId);
    return this.statusService.getStatus(chatbotId);
  }

  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('chatbot:write')
  async reindex(@Param('chatbotId') chatbotId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    // 동시 실행 1건 초과는 즉시 409로 거부한다(FR-N1-22, AC-N1-17). `isRunning()`→`schedule()`이
    // 전부 동기라 이 두 줄 사이에 다른 요청이 끼어들 수 없다(단일 프로세스 전제, ReindexQueueService 주석).
    if (this.reindexQueue.isRunning(chatbotId)) {
      throw new ApiException('REINDEX_IN_PROGRESS', 409, '이미 재색인이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    // 202로 즉시 응답하고 실제 재색인은 백그라운드에서 진행한다 — 대량 색인이 API 응답을 물지 않는다.
    this.reindexQueue.schedule(chatbotId);
  }
}
