// 헬스 대기 — 자식이 죽었으면 시간 초과를 기다리지 않고 바로 실패한다.
import { httpJson, type HttpResult } from '../util/json-request';
import { waitFor } from '../util/wait-for';

export class ProcessDiedError extends Error {
  constructor(public readonly label: string) {
    super(`${label}이(가) 헬스 확인 중에 종료됐습니다`);
    this.name = 'ProcessDiedError';
  }
}

export interface WaitHealthyOptions {
  url: string;
  label: string;
  timeoutMs: number;
  intervalMs?: number;
  /** 응답이 "준비됨"인지 판정(기본: 2xx). */
  accept?: (res: HttpResult) => boolean;
  /** 자식이 이미 종료했는지. */
  hasExited?: () => boolean;
  signal?: AbortSignal;
}

export async function waitHealthy(opts: WaitHealthyOptions): Promise<HttpResult> {
  const accept = opts.accept ?? ((r) => r.ok);
  return waitFor(
      async () => {
        if (opts.hasExited?.()) throw new ProcessDiedError(opts.label);
        const res = await httpJson(opts.url, { timeoutMs: 2000 }).catch(() => null);
        return res && accept(res) ? res : false;
      },
    {
      timeoutMs: opts.timeoutMs,
      intervalMs: opts.intervalMs ?? 500,
      label: `${opts.label} 헬스`,
      signal: opts.signal,
      isFatal: (e) => e instanceof ProcessDiedError,
    },
  );
}
