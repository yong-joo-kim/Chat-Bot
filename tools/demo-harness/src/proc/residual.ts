// 이전 실행의 잔존 프로세스 정리(설계 §6.6 · AC-DH1-5 · FR-DH8-3).
// `pids.json`에 cleanedUp이 없는 실행 폴더의 PID마다 현재 명령줄을 읽어, 기록한 표식이 있을 때만 트리 종료한다.
// 표식이 없으면 PID가 재사용된 다른 프로세스일 수 있으므로 건드리지 않고 기록만 남긴다.
// 설계 보강(2026-10-01 실측): 소유 하네스가 아직 살아 있는 실행(서버 유지 중인 `--prepare-only`·`--no-teardown` 포함)의 자식은
// 정리하지 않는다 — 다음 실행이 진행 중인 실행을 부수는 사고를 막는다.
import { join } from 'node:path';
import { listRunIds, readPidsFile, writePidsFile, type PidsFile } from '../run/run-dir';
import { commandLineHasMarker, type CimProcess } from './parsers';
import { killTreeSync } from './tree-kill';
import { queryProcessCommandLines } from './system';
import { isoWithOffset } from '../util/time';

export interface ResidualPorts {
  /** 시험 주입용 — 기본은 실제 CIM 조회. */
  queryCommandLines: (pids: number[]) => CimProcess[];
  kill: (pid: number) => { ok: boolean };
}

const REAL: ResidualPorts = { queryCommandLines: queryProcessCommandLines, kill: killTreeSync };

export interface ResidualOptions {
  /** 이 실행은 건너뛴다(현재 실행). */
  exclude?: string;
  /** 이 실행만 처리한다(`--stop`). */
  only?: string;
  /** 소유 하네스가 살아 있어도 자식을 정리한다(`--stop`이 하네스 종료를 확인한 뒤 쓴다). */
  ignoreLiveOwner?: boolean;
}

export interface ResidualReport {
  runId: string;
  killed: number[];
  skippedNoMarker: number[];
  alreadyGone: number[];
  /** 아직 살아 있는 하네스가 소유한 실행이라 건드리지 않았다(그 하네스 PID). */
  liveOwnerPid?: number;
}

/** 하네스(`node .../dist/src/cli.js`)의 명령줄인지 — PID 재사용으로 다른 프로세스를 소유자로 착각하지 않게. */
export function isHarnessCommandLine(commandLine: string): boolean {
  return /[\\/]cli\.js(\s|$|")/.test(commandLine) && /demo-harness|dist[\\/]src/i.test(commandLine);
}

/** 하네스 PID가 지금도 살아 있는 하네스인지(명령줄 확인). */
export function isHarnessAlive(pid: number, ports: ResidualPorts = REAL): boolean {
  const p = ports.queryCommandLines([pid]).find((x) => x.pid === pid);
  return p !== undefined && isHarnessCommandLine(p.commandLine);
}

export function cleanupResidual(runsDir: string, opts: ResidualOptions = {}, ports: ResidualPorts = REAL): ResidualReport[] {
  const reports: ResidualReport[] = [];
  for (const runId of listRunIds(runsDir)) {
    if (runId === opts.exclude) continue;
    if (opts.only !== undefined && runId !== opts.only) continue;
    const file = join(runsDir, runId, 'pids.json');
    const pids = readPidsFile(file);
    if (!pids || pids.cleanedUp || pids.entries.length === 0) continue;

    const alive = ports.queryCommandLines([...pids.entries.map((e) => e.pid), ...(pids.harnessPid ? [pids.harnessPid] : [])]);
    const byPid = new Map(alive.map((p) => [p.pid, p]));
    const owner = pids.harnessPid ? byPid.get(pids.harnessPid) : undefined;
    if (!opts.ignoreLiveOwner && owner && isHarnessCommandLine(owner.commandLine)) {
      // 소유 하네스가 살아 있다 — 진행 중인 실행이므로 자식을 건드리지 않는다
      reports.push({ runId, killed: [], skippedNoMarker: [], alreadyGone: [], liveOwnerPid: pids.harnessPid });
      continue;
    }
    const killed: number[] = [];
    const skipped: number[] = [];
    const gone: number[] = [];
    for (const e of pids.entries) {
      const proc = byPid.get(e.pid);
      if (!proc) {
        gone.push(e.pid);
        continue;
      }
      if (commandLineHasMarker(proc.commandLine, e.marker)) {
        ports.kill(e.pid);
        killed.push(e.pid);
      } else {
        skipped.push(e.pid);
      }
    }
    const updated: PidsFile = {
      ...pids,
      cleanedUp: true,
      residual: { handledAt: isoWithOffset(new Date()), killed, skippedNoMarker: skipped, alreadyGone: gone },
    };
    writePidsFile(file, updated);
    reports.push({ runId, killed, skippedNoMarker: skipped, alreadyGone: gone });
  }
  return reports;
}
