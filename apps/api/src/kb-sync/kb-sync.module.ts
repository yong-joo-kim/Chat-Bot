import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { CLOCK, SystemClock } from '../common/polling/clock';
import { NodeHttpTransport } from '../legacy-api/transport/node-http.transport';
import { NodeDnsResolver } from '../legacy-api/transport/node-dns.resolver';
import { KB_DNS_RESOLVER, KB_TRANSPORT, KbCrawlHttpFetcher } from './crawl/kb-crawl-http.fetcher';
import { KbSecretResolver } from './crawl/kb-secret.resolver';
import { KbHostPacer } from './crawl/kb-host-pacer';
import { ConfigService } from '@nestjs/config';
import { KB_EXTRACTOR } from './extract/kb-extractor.port';
import { WorkerThreadExtractor } from './extract/worker-thread.extractor';
import { KB_RAG_CALL_LIMITER, createKbRagCallLimiter } from './lib/kb-rag-call-limiter';
import { KbRunStore } from './core/kb-run.store';
import { KbScheduler } from './engine/kb-scheduler';
import { KbCrawlRunner } from './engine/kb-crawl.runner';
import { KbIngestRunner } from './engine/kb-ingest.runner';
import { KbSyncJob } from './engine/kb-sync.job';
import { KbSourcesService } from './kb-sources.service';
import { KbRunsService } from './kb-runs.service';
import { KbStatusService } from './kb-status.service';
import { KbSourcesController } from './kb-sources.controller';
import { ChatbotKbStatusController } from './chatbot-kb-status.controller';

/**
 * [신규 No.43] 지식베이스 동기화 모듈(§2.2) — export 0개. `RagHttpClient`는 `RagModule`이 이미
 * 전역 export한다(`AppModule`에 이미 등록돼 있어 여기서 다시 import하지 않아도 DI가 해석된다).
 * 거버넌스 모듈 import 0(G-10) · `packages/dialogue-engine`·위젯·ml-worker·공개 대화 심볼 0(KB-18).
 *
 * 기본값은 운영 구현 `WorkerThreadExtractor`다(§7.2 — 문서 해석을 작업 스레드 샌드박스에서 격리하는
 * 것이 보안 설계 요건이라 개발·운영 구분 없이 이 값을 쓴다). 빌드 산출물(`dist/kb-sync/extract/
 * extract.worker.js`)이 없으면 **조용히 인프로세스로 돌아가지 않고** 실제 문서 해석 시도 시점에
 * 명확한 오류를 던진다(`workerScriptPath()` — `pnpm build`를 먼저 하라는 안내). `pnpm dev`/
 * `ts-node-dev`로 소스에서 직접 띄우는 로컬 개발 환경도 마찬가지로 최초 1회 빌드가 필요하다.
 * ts-jest처럼 빌드 산출물 없이 도는 시험은 `KB_EXTRACTOR`를 `InProcessExtractor`로 override한다
 * (같은 순수 로직(`run-extract-job.ts`)을 스레드 격리 없이 직접 호출 — 시험 구성 변경일 뿐 프로덕션
 * 배선은 그대로다).
 */
@Module({
  // `RagModule`은 이 모듈이 실제로 주입하는 `RagHttpClient`만 쓴다 — 질의 게이트·호출 로그·답변
  // 서비스(질의 전용 심볼)는 주입하지 않는다(KB-19 · 제약 ⑫).
  imports: [RagModule],
  controllers: [KbSourcesController, ChatbotKbStatusController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: KB_TRANSPORT, useClass: NodeHttpTransport },
    { provide: KB_DNS_RESOLVER, useClass: NodeDnsResolver },
    { provide: KB_EXTRACTOR, useClass: WorkerThreadExtractor },
    { provide: KB_RAG_CALL_LIMITER, useFactory: createKbRagCallLimiter, inject: [ConfigService] },
    KbSecretResolver,
    KbHostPacer,
    KbCrawlHttpFetcher,
    KbRunStore,
    KbScheduler,
    KbCrawlRunner,
    KbIngestRunner,
    KbSyncJob,
    KbSourcesService,
    KbRunsService,
    KbStatusService,
  ],
  exports: [],
})
export class KbSyncModule {}
