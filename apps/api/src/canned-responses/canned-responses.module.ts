import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';

/** [신규 No.24] 챗봇별 공용 자주 쓰는 문장 CRUD·위/아래 이동·감사(P-11). `AuditLogService`는
 * `AuditLogsModule`이 전역이라 별도 import 없이 주입된다. */
@Module({
  imports: [ChatbotsModule],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesService],
  exports: [CannedResponsesService],
})
export class CannedResponsesModule {}
