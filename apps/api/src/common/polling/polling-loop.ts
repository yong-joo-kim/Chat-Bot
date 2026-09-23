/**
 * [신규 2026-09-23 No.28] `PollingLoop` — 도메인 무관 주기 실행 부품(NFR-DM3, §7.1).
 * `setTimeout` 체인(겹침이 구조적으로 불가능) · 예외 흡수 · `stop()`이 진행 중 tick을 기다린다.
 * `deploy-schedules/**` 밖에서 Prisma·예약 타입을 import하지 않는다(§16 D-11) — No.45 정리 배치가
 * 재사용할 수 있는 토대다.
 */

export interface LoggerLike {
  warn(message: string): void;
}

export interface TickSignal {
  stopping(): boolean;
}

export interface PollingLoopOptions {
  name: string;
  intervalMs: number;
  onTick: (signal: TickSignal) => Promise<void>;
  logger: LoggerLike;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

export class PollingLoop {
  private stoppingFlag = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private runningPromise: Promise<void> | null = null;

  constructor(private readonly options: PollingLoopOptions) {}

  /** 이번 tick의 결과와 무관하게 예외를 흡수한다(AC-D2-8 — 타이머가 죽지 않는다). */
  private async executeTick(): Promise<void> {
    try {
      await this.options.onTick({ stopping: () => this.stoppingFlag });
    } catch (e) {
      this.options.logger.warn(`[${this.options.name}] tick 실행 중 예외를 흡수했습니다: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  /** 이미 진행 중인 tick이 있으면 그 Promise를 반환한다(중복 실행 없음). 기동 직후 1회 실행·시험용. */
  runOnce(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;
    const p = this.executeTick().finally(() => {
      this.runningPromise = null;
    });
    this.runningPromise = p;
    return p;
  }

  private scheduleNext(): void {
    if (this.stoppingFlag) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce().finally(() => this.scheduleNext());
    }, this.options.intervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** "이전 tick 종료 후 intervalMs 뒤 다음 tick" — 느린 tick이 다음 tick과 겹치지 않는다(FR-D3-7). */
  start(): void {
    this.stoppingFlag = false;
    this.scheduleNext();
  }

  /** 타이머 해제 + stopping=true + 진행 중 tick 완료를 상한 시간까지 기다린다. */
  async stop(maxWaitMs = 30_000): Promise<void> {
    this.stoppingFlag = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.runningPromise) {
      await Promise.race([this.runningPromise, delay(maxWaitMs)]);
    }
  }
}
