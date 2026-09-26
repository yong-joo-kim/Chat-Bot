import { Module } from '@nestjs/common';
import { INBOX_SIGNAL_SINK } from '../../common/inbox/inbox-signal.port';
import { InboxParticipationCache } from './inbox-participation.cache';
import { InboxSignalService } from './inbox-signal.service';
import { InboxStore } from './inbox.store';

/**
 * [신규 No.42] 쓰기 유일 + 참여 캐시 + 신호 처리(ADR-0042 §2). export 3개(`InboxStore`·
 * `InboxParticipationCache`·`INBOX_SIGNAL_SINK`) — 주입 파일은 `inbox/**`로 봉인한다(O-11).
 */
@Module({
  providers: [InboxStore, InboxParticipationCache, InboxSignalService, { provide: INBOX_SIGNAL_SINK, useExisting: InboxSignalService }],
  exports: [InboxStore, InboxParticipationCache, INBOX_SIGNAL_SINK],
})
export class InboxCoreModule {}
