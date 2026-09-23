import { Injectable, Logger } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { VectorCacheService } from '../vector-cache.service';

/**
 * 단일 인스턴스 in-process 재색인 큐(FR-N1-3, ADR-0024) — Redis/BullMQ는 도입하지 않는다.
 * 챗봇당 동시 실행 1건(FR-N1-22, AC-N1-17) — `isRunning()` 확인과 `schedule()`의 플래그 설정이
 * 전부 동기(await 없음)라 단일 프로세스 내에서 경합이 생기지 않는다. 중복 요청 거부(409)는
 * 호출부(`EmbeddingController`)가 `isRunning()`을 먼저 확인해 처리한다.
 */
@Injectable()
export class ReindexQueueService {
  private readonly logger = new Logger('ReindexQueueService');
  private readonly running = new Set<string>();
  /**
   * [신규 2026-09-23 No.25] 재실행 예약 플래그(§8.7, ADR-0031 §5 부수 결정) — 실행 중 들어온
   * `schedule()` 호출을 버리지 않고 종료 후 1회 재실행한다. 복원처럼 수백 행이 한 번에 바뀔 때
   * "시작 시점에 이미 읽어버린 색인이 그 뒤의 쓰기를 영영 놓치는" 잠재 결함을 보완한다. 수동
   * 재색인의 `409 REINDEX_IN_PROGRESS`(`isRunning()` 기반)와 "챗봇당 동시 실행 1건"은 불변이다.
   */
  private readonly rerunRequested = new Set<string>();

  constructor(
    private readonly indexer: IndexerService,
    private readonly vectorCache: VectorCacheService,
  ) {}

  isRunning(chatbotId: string): boolean {
    return this.running.has(chatbotId);
  }

  /**
   * best-effort 예약(DD-76) — 대화 자산 쓰기 성공 직후(자동) 또는 수동 재색인 요청(`POST .../reindex`)
   * 양쪽에서 호출한다. 실패해도 쓰기 트랜잭션에 영향 없다(FR-N1-20). 이미 실행 중이면 **재실행을
   * 예약**하고 조용히 반환한다 — 중복 실행 거부(409)는 호출부의 책임이다.
   */
  schedule(chatbotId: string): void {
    if (this.running.has(chatbotId)) {
      this.rerunRequested.add(chatbotId);
      return;
    }
    this.run(chatbotId);
  }

  private run(chatbotId: string): void {
    this.running.add(chatbotId);
    void this.indexer
      .reindexChatbot(chatbotId)
      .catch((e) => this.logger.warn(`색인 실패: chatbotId=${chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`))
      .finally(() => {
        this.running.delete(chatbotId);
        this.vectorCache.invalidate(chatbotId);
        if (this.rerunRequested.delete(chatbotId)) {
          this.run(chatbotId);
        }
      });
  }
}
