import { Injectable } from '@nestjs/common';
import type { AsyncJobStatusSink } from '../../training-jobs/training-job.queue';
import { PrismaService } from '../../prisma/prisma.service';
import { TestRunCancelRegistry } from './test-run-cancel.registry';

/**
 * `TrainingJobQueue`의 상태 기록 포트 두 번째 구현(ADR-0029 §4) — `jobId`(=`runId`)가 가리키는
 * 행은 `TrainingJob`이 아니라 `TestRun`이다. `TestRun`이 영속 **비교 자산**이라 보존 정책이
 * `TrainingJob`(로그성 작업 상태)과 다르므로 상태를 직접 소유한다.
 *
 * `markFinished`는 **현재 상태가 `CANCELLED`인 행을 덮어쓰지 않는다**(CAS) — 취소 요청이 실행
 * 완료보다 먼저 반영됐다면 그 결정을 존중한다.
 */
@Injectable()
export class TestRunStatusSink implements AsyncJobStatusSink {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancelRegistry: TestRunCancelRegistry,
  ) {}

  async markRunning(runId: string): Promise<void> {
    await this.prisma.testRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
  }

  async updateProgress(runId: string, progress: number): Promise<void> {
    await this.prisma.testRun
      .updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: { progress: Math.max(0, Math.min(100, Math.round(progress))) },
      })
      .catch(() => undefined); // 진행률 갱신 실패는 실행을 막지 않는다(관측용 부가 정보).
  }

  async markFinished(
    runId: string,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    resultSummary?: Record<string, unknown>,
    failureReason?: string,
  ): Promise<void> {
    // TestRunStatus에는 PARTIAL이 없다 — 실행기는 PARTIAL을 반환하지 않지만, 방어적으로 SUCCEEDED로 흡수한다.
    const mapped = status === 'PARTIAL' ? 'SUCCEEDED' : status;
    try {
      await this.prisma.testRun.updateMany({
        where: { id: runId, status: { not: 'CANCELLED' } },
        data: {
          status: mapped,
          progress: 100,
          finishedAt: new Date(),
          ...(resultSummary !== undefined ? { summary: JSON.stringify(resultSummary) } : {}),
          ...(failureReason !== undefined ? { failureReason } : {}),
        },
      });
    } finally {
      // 실행이 최종 상태(성공/실패/이미 CANCELLED)에 도달했다 — 취소 레지스트리 항목을 정리해
      // 프로세스 수명 동안 무한히 누적되는 것을 막는다(code-review 대응). DB 갱신이 실패해도 정리한다.
      this.cancelRegistry.clear(runId);
    }
  }
}
