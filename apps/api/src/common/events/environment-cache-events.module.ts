import { Global, Module } from '@nestjs/common';
import { EnvironmentCacheEvents } from './environment-cache.events';

/** [신규 No.40 R1 — M-1] `PrismaModule`과 같은 전역 인프라 패턴 — `AppModule`에 한 번만 import한다. */
@Global()
@Module({
  providers: [EnvironmentCacheEvents],
  exports: [EnvironmentCacheEvents],
})
export class EnvironmentCacheEventsModule {}
