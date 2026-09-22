import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingProviderFactory } from './embedding-provider.factory';
import { QueryEmbeddingService } from './query-embedding.service';
import { VectorCacheService } from './vector-cache.service';
import { SemanticMatchService } from './semantic-match.service';
import { IndexerService } from './index/indexer.service';
import { ReindexQueueService } from './index/reindex-queue.service';
import { EmbeddingStatusService } from './index/embedding-status.service';

/**
 * 1단계(NLU 의미 유사도 매칭) 모듈(nlu-rag-answering-설계.md §7.1). `dialogue-common`을
 * 의존하지 않는다 — 색인 대상은 Prisma에서 직접 읽는다(DD-85). `conversation`·`answer-settings`·
 * `simulation`이 이 모듈의 서비스를 소비한다.
 */
@Module({
  imports: [ChatbotsModule],
  controllers: [EmbeddingController],
  providers: [
    EmbeddingProviderFactory,
    QueryEmbeddingService,
    VectorCacheService,
    SemanticMatchService,
    IndexerService,
    ReindexQueueService,
    EmbeddingStatusService,
  ],
  exports: [EmbeddingProviderFactory, QueryEmbeddingService, VectorCacheService, SemanticMatchService, ReindexQueueService, EmbeddingStatusService],
})
export class EmbeddingModule {}
