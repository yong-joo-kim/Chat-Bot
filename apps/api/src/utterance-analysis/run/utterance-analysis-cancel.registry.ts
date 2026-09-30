import { Injectable } from '@nestjs/common';

/**
 * 분석 취소 레지스트리(No.21 — 설계서 §8.3) — 프로세스 로컬 `Set` 1개(`TestRunCancelRegistry` 선례). DB의
 * `UtteranceAnalysis.status`와 이중으로 판정해, 다중 인스턴스 전환 시에도 DB 상태가 최종 근거로 남는다(K-11).
 */
@Injectable()
export class UtteranceAnalysisCancelRegistry {
  private readonly cancelled = new Set<string>();

  cancel(analysisId: string): void {
    this.cancelled.add(analysisId);
  }

  isCancelled(analysisId: string): boolean {
    return this.cancelled.has(analysisId);
  }

  clear(analysisId: string): void {
    this.cancelled.delete(analysisId);
  }
}
