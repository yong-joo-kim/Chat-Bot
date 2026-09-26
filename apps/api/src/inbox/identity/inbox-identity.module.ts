import { Module } from '@nestjs/common';
import { BannedWordsModule } from '../../banned-words/banned-words.module';
import { InboxCoreModule } from '../core/inbox-core.module';
import { InboxIdentityService } from './inbox-identity.service';
import { InboxIdentitySecretResolver } from './inbox-identity-secret.resolver';
import { IdentityFailureCounter } from './identity-failure-counter';

/**
 * [신규 No.42] 공개 경로 전용(검증 + 연결 적재 요청, ADR-0042 §2). 도메인 모듈 import 0(순환 방지).
 * export 3개(`InboxIdentityService`·`InboxIdentitySecretResolver`·`IdentityFailureCounter`) — 리졸버·
 * 카운터 주입 파일은 `inbox/**`로 봉인한다(O-1·O-11).
 */
@Module({
  imports: [InboxCoreModule, BannedWordsModule],
  providers: [InboxIdentityService, InboxIdentitySecretResolver, IdentityFailureCounter],
  exports: [InboxIdentityService, InboxIdentitySecretResolver, IdentityFailureCounter],
})
export class InboxIdentityModule {}
