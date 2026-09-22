import { useEffect, useRef, useState } from 'react';
import type { TrainingJob } from '@chat-bot/shared-types';

export interface TrainingJobPollingOptions {
  /** 첫 조회까지의 지연(ms). */
  initialDelayMs: number;
  /** 이후 조회 간격(ms). */
  intervalMs: number;
  /** 이 시간을 넘기면 폴링을 정리한다(무한 로딩 금지, UIUX §8). */
  maxWaitMs: number;
}

export type TrainingJobPollingState =
  | { phase: 'idle' }
  | { phase: 'polling'; job: TrainingJob | null }
  | { phase: 'timeout' }
  | { phase: 'done'; job: TrainingJob };

const TERMINAL_STATUSES = new Set<TrainingJob['status']>(['SUCCEEDED', 'PARTIAL', 'FAILED']);

/**
 * 증강 생성(§4.3)·분류기 재학습(§5.3) 공용 폴링 훅(UIUX §8 비동기 대기 패턴).
 * `jobId`가 `null`이면 대기 상태(`idle`)다. 조회 실패는 폴링을 멈추지 않고 다음 주기에 재시도한다.
 */
export function useTrainingJobPolling(
  jobId: string | null,
  fetchJob: (jobId: string) => Promise<TrainingJob>,
  options: TrainingJobPollingOptions,
): TrainingJobPollingState {
  const [state, setState] = useState<TrainingJobPollingState>({ phase: jobId ? 'polling' : 'idle', job: null });
  const fetchJobRef = useRef(fetchJob);
  fetchJobRef.current = fetchJob;

  useEffect(() => {
    if (!jobId) {
      setState({ phase: 'idle' });
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    setState({ phase: 'polling', job: null });

    async function tick(): Promise<void> {
      if (cancelled) return;
      try {
        const job = await fetchJobRef.current(jobId as string);
        if (cancelled) return;
        if (TERMINAL_STATUSES.has(job.status)) {
          setState({ phase: 'done', job });
          return;
        }
        setState({ phase: 'polling', job });
      } catch {
        // 조회 실패는 폴링을 멈추지 않는다 — 다음 주기에 재시도한다.
      }
      if (cancelled) return;
      if (Date.now() - startedAt >= options.maxWaitMs) {
        setState({ phase: 'timeout' });
        return;
      }
      timer = setTimeout(() => void tick(), options.intervalMs);
    }

    timer = setTimeout(() => void tick(), options.initialDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, options.initialDelayMs, options.intervalMs, options.maxWaitMs]);

  return state;
}
