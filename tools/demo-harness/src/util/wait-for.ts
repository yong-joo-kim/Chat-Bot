// 조건 대기 규약(설계 §9.2 · NFR-DHR2) — `apps/api/src/integration/helpers/eventual.helper.ts`와 같은 의미:
// 조건이 참이 될 때까지 폴링하고, 시간 초과 시 라벨이 든 오류를 던진다.
// 고정 지연으로 결과를 기다리는 코드는 금지(정적 검사 H-S2) — setTimeout은 이 파일과 scenario/pacing.ts에만 둔다.

export class WaitTimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number,
    public readonly lastError?: unknown,
  ) {
    super(`조건 대기 시간 초과: ${label} (${timeoutMs}ms)${lastError ? ` - 마지막 오류: ${String(lastError)}` : ''}`);
    this.name = 'WaitTimeoutError';
  }
}

export class WaitAbortedError extends Error {
  constructor(public readonly label: string) {
    super(`조건 대기 중단: ${label}`);
    this.name = 'WaitAbortedError';
  }
}

export interface WaitForOptions {
  timeoutMs: number;
  intervalMs?: number;
  label: string;
  /** 취소 신호(Ctrl+C 등) — abort되면 즉시 WaitAbortedError. */
  signal?: AbortSignal;
  /** true를 돌려주는 오류는 기다리지 않고 즉시 다시 던진다(예: 자식 프로세스 종료). */
  isFatal?: (e: unknown) => boolean;
}

export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      signal?.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** check가 truthy를 돌려줄 때까지 대기하고 그 값을 반환한다. check가 던진 오류는 마지막 오류로 기억하고 계속 시도한다. */
export async function waitFor<T>(
  check: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  opts: WaitForOptions,
): Promise<T> {
  const interval = opts.intervalMs ?? 200;
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown;
  for (;;) {
    if (opts.signal?.aborted) throw new WaitAbortedError(opts.label);
    try {
      const v = await check();
      if (v) return v as T;
      lastError = undefined;
    } catch (e) {
      if (opts.isFatal?.(e)) throw e;
      lastError = e;
    }
    if (Date.now() + interval > deadline) throw new WaitTimeoutError(opts.label, opts.timeoutMs, lastError);
    await sleepMs(interval, opts.signal);
  }
}

/** promise가 ms 안에 끝나지 않으면 fallback을 돌려준다(점검용 짧은 시간 제한). */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** 단계 전체 상한 — promise가 timeoutMs 안에 끝나지 않으면 WaitTimeoutError, 취소 신호가 오면 WaitAbortedError. */
export function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WaitTimeoutError(label, timeoutMs)), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WaitAbortedError(label));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
