// 실행 폴더(설계 §5 P1 · §6.6) — `.demo-runs/<runId>/` 생성·보존 개수·`state.json`·`pids.json`.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRunId, makeRunId, isoWithOffset } from '../util/time';
import type { Ports } from '../config';
import type { RunState } from '../scenario/types';

export interface RunPaths {
  runId: string;
  dir: string;
  logs: string;
  shots: string;
  video: string;
  gif: string;
  report: string;
  mlWorkerCwd: string;
  browserProfile: string;
  dbFile: string;
  stateFile: string;
  pidsFile: string;
}

export function runPathsFor(runsDir: string, runId: string): RunPaths {
  const dir = join(runsDir, runId);
  return {
    runId,
    dir,
    logs: join(dir, 'logs'),
    shots: join(dir, 'shots'),
    video: join(dir, 'video'),
    gif: join(dir, 'gif'),
    report: join(dir, 'report'),
    mlWorkerCwd: join(dir, 'ml-worker'),
    browserProfile: join(dir, 'browser-profile'),
    dbFile: join(dir, 'demo.db'),
    stateFile: join(dir, 'state.json'),
    pidsFile: join(dir, 'pids.json'),
  };
}

/** 새 실행 폴더를 만든다(ml-worker 작업 폴더는 빈 폴더 — 개발자 .env 미적재, C-19). */
export function createRunDir(runsDir: string, now: Date = new Date(), rand?: () => number): RunPaths {
  mkdirSync(runsDir, { recursive: true });
  let runId = makeRunId(now, rand);
  while (existsSync(join(runsDir, runId))) runId = makeRunId(now, rand);
  const p = runPathsFor(runsDir, runId);
  for (const d of [p.dir, p.logs, p.shots, p.video, p.gif, p.report, p.mlWorkerCwd]) mkdirSync(d, { recursive: true });
  return p;
}

/** 실행 ID 폴더 목록(이름 오름차순 = 오래된 순). 규칙에 안 맞는 폴더(.build-stamp.json 등)는 건드리지 않는다. */
export function listRunIds(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((n) => isRunId(n) && statSync(join(runsDir, n)).isDirectory())
    .sort();
}

export function resolveRunId(runsDir: string, idOrLatest: string): string | null {
  if (idOrLatest !== 'latest') return existsSync(join(runsDir, idOrLatest)) ? idOrLatest : null;
  const all = listRunIds(runsDir);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** 오래된 실행 폴더 정리(FR-0-314). 현재 실행은 항상 보존한다. 삭제 못 한 폴더는 건너뛰고 다음 실행이 재시도(EX-DH-18). */
export function pruneRunDirs(runsDir: string, keep: number, currentRunId?: string): { removed: string[]; failed: string[] } {
  const ids = listRunIds(runsDir);
  const removed: string[] = [];
  const failed: string[] = [];
  const excess = ids.length - keep;
  for (const id of ids.slice(0, Math.max(0, excess))) {
    if (id === currentRunId) continue;
    try {
      rmSync(join(runsDir, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { removed, failed };
}

// ── state.json(재개용 — 비밀 없음) ─────────────────────────────────────────────
export type RunPhase = 'created' | 'preflight' | 'prepared' | 'booted' | 'data' | 'show' | 'done' | 'aborted' | 'failed';

export interface RunStateFile {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  mode: 'visible' | 'headless-check';
  preset: string;
  ports: Ports;
  phase: RunPhase;
  /** 끝난 구간 키(재개 단위 — 설계 A-8). */
  completedSegments: string[];
  /** 비밀 아닌 실행 상태(챗봇 ID 등). */
  state: RunState;
  /** 서버 유지(--no-teardown·--prepare-only) 중인지. */
  serversKept: boolean;
  note?: string;
}

export function writeStateFile(path: string, s: RunStateFile, redact?: (t: string) => string): void {
  const text = JSON.stringify({ ...s, updatedAt: isoWithOffset(new Date()) }, null, 2);
  const out = redact ? redact(text) : text;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, out, 'utf8');
  renameSync(tmp, path);
}

export function readStateFile(path: string): RunStateFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RunStateFile;
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

// ── pids.json(잔존 정리용) ─────────────────────────────────────────────────────
export interface PidEntry {
  name: string;
  pid: number;
  /** 명령줄 표식(`--title=cbdemo-api-<runId>` · `cbdemo_run=<runId>` · `--user-data-dir=<폴더>`). */
  marker: string;
  startedAt: string;
}

export interface PidsFile {
  schemaVersion: 1;
  runId: string;
  entries: PidEntry[];
  /** 이 실행을 소유한 하네스 프로세스 PID — 살아 있는 하네스의 자식을 다른 실행이 정리하지 않도록(잔존 정리가 확인). */
  harnessPid?: number;
  cleanedUp: boolean;
  /** 다음 실행의 잔존 정리가 처리한 결과 기록(표식 없는 PID는 건드리지 않고 남김). */
  residual?: { handledAt: string; killed: number[]; skippedNoMarker: number[]; alreadyGone: number[] };
}

export class PidRegistry {
  private data: PidsFile;
  constructor(
    private readonly file: string,
    runId: string,
  ) {
    this.data = { schemaVersion: 1, runId, entries: [], harnessPid: process.pid, cleanedUp: false };
    this.flush();
  }

  add(entry: Omit<PidEntry, 'startedAt'>): void {
    this.data.entries.push({ ...entry, startedAt: isoWithOffset(new Date()) });
    this.flush();
  }

  markCleanedUp(): void {
    this.data.cleanedUp = true;
    this.flush();
  }

  get entries(): readonly PidEntry[] {
    return this.data.entries;
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}

export function readPidsFile(path: string): PidsFile | null {
  try {
    const p = JSON.parse(readFileSync(path, 'utf8')) as PidsFile;
    return p?.schemaVersion === 1 ? p : null;
  } catch {
    return null;
  }
}

export function writePidsFile(path: string, p: PidsFile): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8');
  renameSync(tmp, path);
}
