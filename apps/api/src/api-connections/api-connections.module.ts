import { Module } from '@nestjs/common';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { LegacyApiModule } from '../legacy-api/legacy-api.module';
import { ApiConnectionCatalogModule } from './catalog/api-connection-catalog.module';
import { ApiConnectionsController } from './api-connections.controller';
import { ApiConnectionsService } from './api-connections.service';

/**
 * [No.26] 관리 CRUD 모듈(ADMIN). `legacy-api`를 가져다 쓰지만(연결 테스트) `LegacyApiService`만
 * 주입할 수 있다(export 제한, §13 L-4). `audit-logs`·`prisma`는 전역이라 별도 import가 없다.
 */
@Module({
  imports: [DialogueCommonModule, LegacyApiModule, ApiConnectionCatalogModule],
  controllers: [ApiConnectionsController],
  providers: [ApiConnectionsService],
  exports: [ApiConnectionsService],
})
export class ApiConnectionsModule {}
