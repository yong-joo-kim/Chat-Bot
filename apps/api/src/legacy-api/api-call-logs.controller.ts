import { Controller, Get, Param, Query } from '@nestjs/common';
import type { ApiCallLogItem, ApiCallLogListQuery, ApiCallLogSummary, Paginated } from '@chat-bot/shared-types';
import { ApiCallLogListQuerySchema } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiCallLogService } from './api-call-log.service';

/** [No.26] 외부 연동 로그(§9.2, §12.1) — `chatbot:read`(세 역할). */
@Controller('chatbots/:chatbotId/api-call-logs')
export class ApiCallLogsController {
  constructor(private readonly callLogService: ApiCallLogService) {}

  @Get()
  @RequirePermission('chatbot:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(ApiCallLogListQuerySchema)) query: ApiCallLogListQuery,
  ): Promise<Paginated<ApiCallLogItem>> {
    return this.callLogService.list(chatbotId, query);
  }

  @Get('summary')
  @RequirePermission('chatbot:read')
  summary(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(ApiCallLogListQuerySchema)) query: ApiCallLogListQuery,
  ): Promise<ApiCallLogSummary> {
    return this.callLogService.summary(chatbotId, query);
  }
}
