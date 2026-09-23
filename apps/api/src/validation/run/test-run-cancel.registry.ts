import { Injectable } from '@nestjs/common';

/**
 * 실행 취소 레지스트리(§7.2, 개발명세서 §5 확장성) — 프로세스 로컬 `Set` 1개. DB의
 * `TestRun.status`와 이중으로 판정해, 다중 인스턴스 전환 시에도 DB 상태가 최종 근거로 남는다.
 * 이 그룹이 추가하는 단일 인스턴스 상태는 ① TC 임포트 스테이징(기존 재사용) ② 이 레지스트리
 * 1개뿐이다.
 */
@Injectable()
export class TestRunCancelRegistry {
  private readonly cancelled = new Set<string>();

  cancel(runId: string): void {
    this.cancelled.add(runId);
  }

  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  clear(runId: string): void {
    this.cancelled.delete(runId);
  }
}
