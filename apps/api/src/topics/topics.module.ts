import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { AssetTransferModule } from '../asset-transfer/asset-transfer.module';
import { TopicsController } from './topics.controller';
import { TopicAssignmentsController } from './topic-assignments.controller';
import { TopicsService } from './topics.service';
import { TopicAssignmentService } from './topic-assignment.service';
import { TopicReadService } from './topic-read.service';
import { TopicLookupService } from './topic-lookup.service';
import { TopicSplitService } from './topic-split.service';

/**
 * [신규 No.22] `topic-system-설계.md` §2.1~§2.2 — export는 `TopicLookupService` **1개**뿐이다.
 * 토픽 쓰기(`TopicsService`)·자산 소속 일괄 쓰기(`TopicAssignmentService`)·분리는 모듈 밖에서
 * 주입할 수 없다.
 */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule, AssetTransferModule],
  controllers: [TopicsController, TopicAssignmentsController],
  providers: [TopicsService, TopicAssignmentService, TopicReadService, TopicLookupService, TopicSplitService],
  exports: [TopicLookupService],
})
export class TopicsModule {}
