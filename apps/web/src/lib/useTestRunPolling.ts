import { useEffect, useRef, useState } from 'react';
import type { TestRun } from '@chat-bot/shared-types';

export interface TestRunPollingOptions {
  /** 첫 조회까지의 지연(ms). */
  initialDelayMs: number;
  /** 이후 조회 간격(ms). */
  intervalMs: number;
  /** 무한 로딩 방지용 상한(ms) — 대량 실행은 수 분 걸릴 수 있어 넉넉하게 잡는다(UIUX §8). */
  maxWaitMs: number;
}

export type TestRunPollingState =
  | { phase: 'idle' }
  | { phase: 'polling'; run: TestRun }
  | { phase: 'timeout'; run: TestRun | null }
  | { phase: 'done'; run: TestRun };

const TERMINAL_STATUSES = new Set<TestRun['status']>(['SUCCEEDED', 'FAILED', 'CANCELLED']);

/**
 * V4 실행 결과 상세(§4.4)의 폴링 훅. `TrainingJob`이 아니라 `TestRun` 자신을 폴링 대상으로 한다
 * (ADR-0029 §4 — 상태 소유자가 다르다, ui-spec §0-8). 화면을 떠났다 재진입해도 `runId`가 URL에
 * 있으므로 서버 상태를 그대로 다시 조회한다(S-5) — `sessionStorage`가 필요 없다.
 */
export function useTestRunPolling(
  runId: string | null,
  fetchRun: (runId: string) => Promise<TestRun>,
  options: TestRunPollingOptions,
): TestRunPollingState {
  const [state, setState] = useState<TestRunPollingState>({ phase: 'idle' });
  const fetchRunRef = useRef(fetchRun);
  fetchRunRef.current = fetchRun;

  useEffect(() => {
    if (!runId) {
      setState({ phase: 'idle' });
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    async function tick(): Promise<void> {
      if (cancelled) return;
      try {
        const run = await fetchRunRef.current(runId as string);
        if (cancelled) return;
        if (TERMINAL_STATUSES.has(run.status)) {
          setState({ phase: 'done', run });
          return;
        }
        setState({ phase: 'polling', run });
      } catch {
        // 조회 실패는 폴링을 멈추지 않는다 — 다음 주기에 재시도한다.
      }
      if (cancelled) return;
      if (Date.now() - startedAt >= options.maxWaitMs) {
        setState((prev) => ({ phase: 'timeout', run: prev.phase === 'polling' ? prev.run : null }));
        return;
      }
      timer = setTimeout(() => void tick(), options.intervalMs);
    }

    timer = setTimeout(() => void tick(), options.initialDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, options.initialDelayMs, options.intervalMs, options.maxWaitMs]);

  return state;
}
