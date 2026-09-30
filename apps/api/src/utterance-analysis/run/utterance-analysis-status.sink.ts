import { Injectable } from '@nestjs/common';
import type { AsyncJobStatusSink } from '../../training-jobs/training-job.queue';
import { UtteranceAnalysisStore } from '../core/utterance-analysis.store';
import { UtteranceAnalysisCancelRegistry } from './utterance-analysis-cancel.registry';

/**
 * `TrainingJobQueue`의 상태 기록 포트 **세 번째 구현**(ADR-0027 갱신① — `TestRunStatusSink`가 두 번째).
 * `jobId`(= `analysisId`)가 가리키는 행은 `TrainingJob`이 아니라 `UtteranceAnalysis`다 — 분석이 상태를 스스로
 * 소유한다(결과와 상태가 한 행이어야 "성공 = 결과 있음"이 한 트랜잭션이 된다, R-1).
 *
 * 성공 전이는 러너의 `store.commitResults()`가 결과 쓰기와 **같은 트랜잭션**에서 끝내므로, 여기 `markFinished(SUCCEEDED)`
 * 는 할 일이 없다(0행 갱신 — 무해). 실패는 CAS(`status ∈ {QUEUED, RUNNING}`)라 이미 CANCELLED인 행을 덮어쓰지
 * 않는다. `PARTIAL`은 쓰지 않는다(들어오면 FAILED로 흡수 — `TestRunStatusSink` 선례).
 */
@Injectable()
export class UtteranceAnalysisStatusSink implements AsyncJobStatusSink {
  constructor(
    private readonly store: UtteranceAnalysisStore,
    private readonly cancelRegistry: UtteranceAnalysisCancelRegistry,
  ) {}

  async markRunning(analysisId: string): Promise<void> {
    await this.store.markRunning(analysisId);
  }

  async updateProgress(analysisId: string, progress: number): Promise<void> {
    await this.store.updateProgress(analysisId, progress);
  }

  async markFinished(
    analysisId: string,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    _resultSummary?: Record<string, unknown>,
    failureReason?: string,
  ): Promise<void> {
    try {
      if (status !== 'SUCCEEDED') {
        await this.store.markFailed(analysisId, failureReason ?? 'INTERNAL_ERROR');
      }
      // 작업이 끝났다 — 취소된 행도 이제 잠금을 푼다(취소 직후 두 작업이 겹쳐 돌지 않게).
      await this.store.releaseLock(analysisId);
    } finally {
      // 최종 상태에 도달했다 — 취소 레지스트리 항목을 정리한다(프로세스 수명 동안 누적되지 않게).
      this.cancelRegistry.clear(analysisId);
    }
  }
}
