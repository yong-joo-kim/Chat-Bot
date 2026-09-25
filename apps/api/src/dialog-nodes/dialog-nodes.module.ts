import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { ApiConnectionCatalogModule } from '../api-connections/catalog/api-connection-catalog.module';
import { TopicsModule } from '../topics/topics.module';
import { DialogNodesController } from './dialog-nodes.controller';
import { DialogNodesService } from './dialog-nodes.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule, ApiConnectionCatalogModule, TopicsModule],
  controllers: [DialogNodesController],
  providers: [DialogNodesService],
})
export class DialogNodesModule {}
