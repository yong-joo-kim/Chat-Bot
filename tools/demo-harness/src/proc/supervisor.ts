// 프로세스 관리자(설계 §6.6) — 자식 2개(API · ml-worker)와 하네스 내부 정적 서버 3개의 수명·정리·고아 방지.
import type { Ports } from '../config';
import { TIMEOUTS } from '../config';
import type { HarnessServers } from '../servers';
import type { PidRegistry } from '../run/run-dir';
import { ManagedProcess, type ManagedProcessSpec } from './managed-process';
import { waitPortsFree } from './ports';
import { findProcessesByCommandLineMarker } from './system';

export interface TeardownReport {
  /** 표식이 남은 프로세스 수(0이어야 한다) — 고아 확인. */
  processesLeft: number;
  portsFreed: boolean;
  busyPorts: number[];
  killedChildren: string[];
}

export class Supervisor {
  private readonly children: ManagedProcess[] = [];
  private servers: HarnessServers | null = null;
  private tornDown = false;

  constructor(
    private readonly registry: PidRegistry,
    /** 정리 뒤 고아를 찾을 명령줄 표식들(`cbdemo_run=<id>` · `--title=cbdemo-api-<id>`). */
    private readonly markers: string[],
  ) {}

  get processes(): readonly ManagedProcess[] {
    return this.children;
  }

  find(name: string): ManagedProcess | undefined {
    return [...this.children].reverse().find((c) => c.spec.name === name);
  }

  async startChild(spec: ManagedProcessSpec): Promise<ManagedProcess> {
    const p = new ManagedProcess(spec);
    const pid = await p.start();
    this.registry.add({ name: spec.name, pid, marker: spec.marker });
    this.children.push(p);
    return p;
  }

  /** 자식 1개만 종료(예: 단건 지연 결정 뒤 API 재기동). 목록에서도 뺀다. */
  async stopChild(name: string): Promise<void> {
    const p = this.find(name);
    if (!p) return;
    await p.stop();
    const i = this.children.indexOf(p);
    if (i >= 0) this.children.splice(i, 1);
  }

  attachServers(s: HarnessServers): void {
    this.servers = s;
  }

  /** 정상·실패·Ctrl+C 공통 정리(설계 §6.6): 자식 트리 종료 -> 서버 close -> 포트 해제 확인 -> 고아 표식 검사 -> cleanedUp. */
  async teardown(ports: Ports): Promise<TeardownReport> {
    const killed: string[] = [];
    if (!this.tornDown) {
      this.tornDown = true;
      for (const c of [...this.children].reverse()) {
        const r = await c.stop();
        if (r.killed) killed.push(c.spec.name);
      }
      await this.servers?.closeAll().catch(() => undefined);
    }
    const checks = await waitPortsFree(ports, TIMEOUTS.portFreeMs);
    const busy = checks.filter((c) => !c.free).map((c) => c.port);
    let left = 0;
    for (const m of this.markers) left += findProcessesByCommandLineMarker(m).length;
    if (busy.length === 0 && left === 0) this.registry.markCleanedUp();
    return { processesLeft: left, portsFreed: busy.length === 0, busyPorts: busy, killedChildren: killed };
  }

  /** `process.on('exit')`용 동기 정리 — 비동기 불가라 자식 트리 종료만 시도한다. */
  teardownSync(): void {
    for (const c of this.children) c.stopSync();
  }
}
