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
 * 작업 상태 기록 포트(ADR-0029 §4) — `TrainingJobQueue.run()`은 `jobId`가 가리키는 행이
 * `TrainingJob`일 것을 전제로 `markRunning`/`updateProgress`/`markFinished`를 호출한다.
 * 검증/품질 고도화(No.19/20)는 상태를 `TestRun`이 자기 자신 안에 갖고 싶어 하므로("TestRun은
 * 영속 비교 자산, TrainingJob은 로그성 작업 상태" — 보존 정책이 다르다), 큐는 재사용하되 상태
 * 기록만 이 포트로 분리한다. `TrainingJobService`가 첫 구현이고 `TestRunStatusSink`(검증 모듈)가
 * 두 번째다 — 기본 인자로 기존 동작을 보존하므로 기존 호출부 2곳(augmentation·classifier)은 변경 0건이다.
 */
export interface AsyncJobStatusSink {
  markRunning(jobId: string): Promise<void>;
  updateProgress(jobId: string, progress: number): Promise<void>;
  markFinished(
    jobId: string,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    resultSummary?: Record<string, unknown>,
    failureReason?: string,
  ): Promise<void>;
}

/**
 * ★ 교체 지점 1곳(ADR-0027 §4) — 단일 인스턴스 in-process 작업 큐. `ReindexQueueService`
 * (`embedding/index/reindex-queue.service.ts`) 선례와 동일한 fire-and-forget 패턴이며
 * Redis/BullMQ는 도입하지 않는다. 다중 인스턴스 전환 시 이 파일만 교체하면 된다.
 *
 * ⚠ 이 클래스는 `IntentsService`·`KeywordsService`를 알지 못하며 알아서도 안 된다(DD-96 L1/L3) —
 * 실행되는 `task`는 augmentation/classifier/validation 모듈이 주입한 순수 콜백일 뿐이다.
 */
@Injectable()
export class TrainingJobQueue {
  private readonly logger = new Logger('TrainingJobQueue');

  constructor(private readonly jobs: TrainingJobService) {}

  /**
   * fire-and-forget(DD-110) — 호출부는 이 호출 직후 `202 { jobId }`를 반환한다.
   * `sink` 기본값은 `TrainingJobService` 자신이다(ADR-0029 §4) — 기존 호출부 2곳은 이 인자를
   * 넘기지 않으므로 동작이 완전히 그대로 유지된다.
   */
  enqueue(jobId: string, task: TrainingJobTask, sink: AsyncJobStatusSink = this.jobs): void {
    void this.run(jobId, task, sink);
  }

  private async run(jobId: string, task: TrainingJobTask, sink: AsyncJobStatusSink): Promise<void> {
    try {
      await sink.markRunning(jobId);
      const result = await task({ onProgress: (p) => sink.updateProgress(jobId, p) });
      await sink.markFinished(jobId, result.status, result.resultSummary, result.failureReason);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'UNKNOWN_ERROR';
      this.logger.warn(`작업 실패: jobId=${jobId} error=${message}`);
      await sink.markFinished(jobId, 'FAILED', undefined, message).catch(() => undefined);
    }
  }
}
