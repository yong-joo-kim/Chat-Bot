import { Body, Controller, Param, Post } from '@nestjs/common';
import { TopicAssignRequestDto, TopicAssignRequestSchema, TopicAssignResult } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { TopicAssignmentService } from './topic-assignment.service';

/** [신규 No.22] §16.1 ⑪ — 자산 6종 소속 일괄 지정. */
@Controller('chatbots/:chatbotId/topic-assignments')
export class TopicAssignmentsController {
  constructor(private readonly assignmentService: TopicAssignmentService) {}

  @Post()
  @RequirePermission('dialogue:write')
  assign(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(TopicAssignRequestSchema)) dto: TopicAssignRequestDto,
  ): Promise<TopicAssignResult> {
    return this.assignmentService.assign(chatbotId, dto);
  }
}
