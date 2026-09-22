import { Module } from '@nestjs/common';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { RagHttpClient } from './rag-http.client';
import { RagGateService } from './rag-gate.service';
import { RagCallLogService } from './rag-call-log.service';
import { RagAnswerService } from './rag-answer.service';
import { InMemoryPendingAnswerStore } from './pending-answer.store';

/**
 * 2단계(외부 RAG 폴백) 모듈(nlu-rag-answering-설계.md §7.1, ADR-0022/0023). **`conversation`을
 * 모른다** — `RagAnswerService`는 `ConversationLogPort` 인터페이스만 알고, 실제 구현은 호출부
 * (`PublicConversationService`)가 메서드 인자로 전달한다(DD-85, 순환 참조 회피).
 */
@Module({
  imports: [BannedWordsModule],
  providers: [
    RagHttpClient,
    RagGateService,
    RagCallLogService,
    RagAnswerService,
    { provide: 'PendingAnswerStore', useClass: InMemoryPendingAnswerStore },
  ],
  exports: [RagHttpClient, RagGateService, RagAnswerService, 'PendingAnswerStore'],
})
export class RagModule {}
