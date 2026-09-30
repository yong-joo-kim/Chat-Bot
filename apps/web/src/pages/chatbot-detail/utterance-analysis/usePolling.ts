import { useEffect, useRef, useState } from 'react';

export interface PollingOptions {
  /** false면 폴링을 멈춘다(진행 행이 없어지거나 종결 상태에 도달). */
  enabled: boolean;
  intervalMs: number;
  /** 연속 실패가 이 시간(기본 30초)을 넘으면 `degraded`가 켜지고 간격이 늘어난다(UIUX §8). */
  degradedAfterMs?: number;
  degradedIntervalMs?: number;
}

/**
 * 조용한 폴링(`deep-clustering-ui-spec.md` §2.3). `tick`은 실패 시 throw해야 한다(연속 실패를 세기 위해).
 * 탭이 숨겨져 있으면(`document.hidden`) 호출을 건너뛰고 다음 주기를 다시 잡는다. 화면 이탈 시 정리된다.
 */
export function usePolling(tick: () => Promise<void>, options: PollingOptions): { degraded: boolean } {
  const { enabled, intervalMs, degradedAfterMs = 30_000, degradedIntervalMs = 10_000 } = options;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDegraded(false);
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    let failingSince: number | null = null;
    let isDegraded = false;

    const schedule = (): void => {
      timer = window.setTimeout(() => void run(), isDegraded ? degradedIntervalMs : intervalMs);
    };
    const run = async (): Promise<void> => {
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        await tickRef.current();
        failingSince = null;
        if (isDegraded) {
          isDegraded = false;
          if (!cancelled) setDegraded(false);
        }
      } catch {
        if (failingSince === null) failingSince = Date.now();
        if (!isDegraded && Date.now() - failingSince >= degradedAfterMs) {
          isDegraded = true;
          if (!cancelled) setDegraded(true);
        }
      }
      if (!cancelled) schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs, degradedAfterMs, degradedIntervalMs]);

  return { degraded };
}
