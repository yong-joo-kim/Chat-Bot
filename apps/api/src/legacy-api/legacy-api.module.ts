import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { ApiConnectionCatalogModule } from '../api-connections/catalog/api-connection-catalog.module';
import { LegacyApiService } from './legacy-api.service';
import { LegacyApiHttpClient } from './legacy-api-http.client';
import { LegacyApiSecretResolver } from './legacy-api-secret.resolver';
import { LegacyApiGateService } from './legacy-api-gate.service';
import { ApiCallLogService } from './api-call-log.service';
import { ApiCallLogsController } from './api-call-logs.controller';
import { LEGACY_DNS_RESOLVER, LEGACY_TRANSPORT } from './transport/legacy-transport.port';
import { NodeDnsResolver } from './transport/node-dns.resolver';
import { NodeHttpTransport } from './transport/node-http.transport';

/**
 * [No.26] 외부 출구 모듈(ADR-0034). export는 `LegacyApiService`·`ApiCallLogService` 2개뿐이다 —
 * `LegacyApiHttpClient`·전송 포트·시크릿 리졸버·게이트는 export하지 않는다(다른 모듈은 주입 자체가
 * 불가능하다, §13 L-4). `conversation`·`simulation`을 import하지 않는다(§2.2).
 */
@Module({
  imports: [ChatbotsModule, ApiConnectionCatalogModule],
  controllers: [ApiCallLogsController],
  providers: [
    LegacyApiService,
    LegacyApiHttpClient,
    LegacyApiSecretResolver,
    LegacyApiGateService,
    ApiCallLogService,
    { provide: LEGACY_DNS_RESOLVER, useClass: NodeDnsResolver },
    { provide: LEGACY_TRANSPORT, useClass: NodeHttpTransport },
  ],
  exports: [LegacyApiService, ApiCallLogService],
})
export class LegacyApiModule {}
