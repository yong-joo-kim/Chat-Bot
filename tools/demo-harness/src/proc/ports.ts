// 포트 점검(PC-8 · AC-DH1-3) — 127.0.0.1·::1 양쪽에서 실제로 열어 본다.
import { createServer } from 'node:net';
import type { Ports, PortName } from '../config';
import { sleepMs } from '../util/wait-for';

function tryListen(port: number, host: string): Promise<'free' | 'inuse' | 'unavailable'> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' || e.code === 'EACCES') resolve('inuse');
      else resolve('unavailable'); // 예: IPv6 비활성(EADDRNOTAVAIL)
    });
    srv.once('listening', () => srv.close(() => resolve('free')));
    srv.listen({ port, host, exclusive: true });
  });
}

/** 포트가 비어 있는지 — IPv4·IPv6 루프백 중 하나라도 사용 중이면 false. 0.0.0.0 점유(API)도 127.0.0.1 bind 실패로 드러난다. */
export async function isPortFree(port: number): Promise<boolean> {
  const results = await Promise.all([tryListen(port, '127.0.0.1'), tryListen(port, '::1')]);
  return !results.includes('inuse');
}

export interface PortCheck {
  name: PortName;
  port: number;
  free: boolean;
}

export async function checkPorts(ports: Ports): Promise<PortCheck[]> {
  const out: PortCheck[] = [];
  for (const name of Object.keys(ports) as PortName[]) {
    const port = ports[name] as number;
    out.push({ name, port, free: await isPortFree(port) });
  }
  return out;
}

/** 종료 뒤 포트가 모두 해제될 때까지 최대 timeoutMs 폴링(설계 §6.6). */
export async function waitPortsFree(ports: Ports, timeoutMs: number): Promise<PortCheck[]> {
  const deadline = Date.now() + timeoutMs;
  let last = await checkPorts(ports);
  while (last.some((c) => !c.free) && Date.now() < deadline) {
    await sleepMs(250);
    last = await checkPorts(ports);
  }
  return last;
}
