import { Injectable, Logger } from '@nestjs/common';
import { TrainingJobService } from './training-job.service';

export interface TrainingJobTaskResult {
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  readonly resultSummary?: Record<string, unknown>;
  readonly failureReason?: string;
}

export interface TrainingJobTaskContext {
  readonly onProgress: (progress: number) => Promise<void>;
}

export type TrainingJobTask = (ctx: TrainingJobTaskContext) => Promise<TrainingJobTaskResult>;

/**
 * ★ 교체 지점 1곳(ADR-0027 §4) — 단일 인스턴스 in-process 작업 큐. `ReindexQueueService`
 * (`embedding/index/reindex-queue.service.ts`) 선례와 동일한 fire-and-forget 패턴이며
 * Redis/BullMQ는 도입하지 않는다. 다중 인스턴스 전환 시 이 파일만 교체하면 된다.
 *
 * ⚠ 이 클래스는 `IntentsService`·`KeywordsService`를 알지 못하며 알아서도 안 된다(DD-96 L1/L3) —
 * 실행되는 `task`는 augmentation/classifier 모듈이 주입한 순수 콜백일 뿐이다.
 */
@Injectable()
export class TrainingJobQueue {
  private readonly logger = new Logger('TrainingJobQueue');

  constructor(private readonly jobs: TrainingJobService) {}

  /** fire-and-forget(DD-110) — 호출부는 이 호출 직후 `202 { jobId }`를 반환한다. */
  enqueue(jobId: string, task: TrainingJobTask): void {
    void this.run(jobId, task);
  }

  private async run(jobId: string, task: TrainingJobTask): Promise<void> {
    try {
      await this.jobs.markRunning(jobId);
      const result = await task({ onProgress: (p) => this.jobs.updateProgress(jobId, p) });
      await this.jobs.markFinished(jobId, result.status, result.resultSummary, result.failureReason);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'UNKNOWN_ERROR';
      this.logger.warn(`작업 실패: jobId=${jobId} error=${message}`);
      await this.jobs.markFinished(jobId, 'FAILED', undefined, message).catch(() => undefined);
    }
  }
}
