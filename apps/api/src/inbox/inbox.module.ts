import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { SimulationModule } from '../simulation/simulation.module';
import { InboxCoreModule } from './core/inbox-core.module';
import { InboxIdentityModule } from './identity/inbox-identity.module';
import { InboxQueryService } from './read/inbox-query.service';
import { InboxThreadDetailService } from './read/inbox-thread-detail.service';
import { InboxTextReader } from './read/inbox-text.reader';
import { SessionRefLookupService } from './read/session-ref-lookup';
import { InboxThreadsService } from './manage/inbox-threads.service';
import { InboxCustomersService } from './manage/inbox-customers.service';
import { InboxTagsService } from './manage/inbox-tags.service';
import { InboxTestCustomersService } from './manage/inbox-test-customers.service';
import { ChatbotInboxSettingsService } from './manage/chatbot-inbox-settings.service';
import { InboxEnabledGuard } from './guards/inbox-enabled.guard';
import { InboxThreadsController } from './controllers/inbox-threads.controller';
import { InboxCustomersController } from './controllers/inbox-customers.controller';
import { InboxTestCustomersController } from './controllers/inbox-test-customers.controller';
import { InboxTagsController } from './controllers/inbox-tags.controller';
import { ChatbotInboxSettingsController } from './controllers/chatbot-inbox-settings.controller';

/**
 * [신규 No.42] 관리자 32 핸들러(컨트롤러 5개, ADR-0042 §7). **export 0개** — 관리 서비스·읽기
 * 서비스·컨트롤러는 이 모듈 밖에서 주입할 수 없다. `AppModule` imports 끝(`WorkflowModule` 뒤)에 둔다.
 */
@Module({
  imports: [InboxCoreModule, InboxIdentityModule, SimulationModule, AuditLogsModule, BannedWordsModule],
  controllers: [InboxThreadsController, InboxCustomersController, InboxTestCustomersController, InboxTagsController, ChatbotInboxSettingsController],
  providers: [
    InboxQueryService,
    InboxThreadDetailService,
    InboxTextReader,
    SessionRefLookupService,
    InboxThreadsService,
    InboxCustomersService,
    InboxTagsService,
    InboxTestCustomersService,
    ChatbotInboxSettingsService,
    InboxEnabledGuard,
  ],
  exports: [],
})
export class InboxModule {}
