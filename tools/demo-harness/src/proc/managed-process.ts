// 자식 프로세스 1개의 수명 관리(설계 §6.5) — 실행 파일 + 인자 배열로 spawn(셸 0), 출력은 로그 파일 + 마지막 200줄 고리 버퍼.
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { killTreeSync, isPidAlive } from './tree-kill';
import { withTimeout } from '../util/wait-for';

export interface ManagedProcessSpec {
  /** 로그 이름·표시 이름(api · ml-worker). */
  name: string;
  command: string;
  args: string[];
  cwd: string;
  /** 부모 env를 상속하지 않는다 — 호출자가 구성한 전체 env만 넘긴다(DHD-10 1). */
  env: Record<string, string>;
  logFile: string;
  /** 잔존 정리가 PID 재사용을 구분하는 명령줄 표식. */
  marker: string;
  /** 로그에 쓰기 전 비밀 제거(Redactor.redact). */
  redact?: (text: string) => string;
  ringSize?: number;
}

export class ManagedProcess {
  readonly spec: ManagedProcessSpec;
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private readonly ring: string[] = [];
  private partial = '';
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private spawnError: Error | null = null;
  private exitWaiters: Array<() => void> = [];

  constructor(spec: ManagedProcessSpec) {
    this.spec = spec;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get exited(): boolean {
    return this.exitInfo !== null || this.spawnError !== null;
  }

  get exitSummary(): string | null {
    if (this.spawnError) return `실행 실패: ${this.spawnError.message}`;
    if (this.exitInfo) return `종료 코드 ${this.exitInfo.code ?? '(신호 ' + this.exitInfo.signal + ')'}`;
    return null;
  }

  /** 시작하고 PID가 정해질 때까지 기다린다(spawn 실패면 예외). */
  async start(): Promise<number> {
    mkdirSync(dirname(this.spec.logFile), { recursive: true });
    this.log = createWriteStream(this.spec.logFile, { flags: 'a', encoding: 'utf8' });
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: this.spec.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => this.onData(d));
    child.stderr?.on('data', (d: string) => this.onData(d));
    child.on('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      this.flushPartial();
      this.wake();
    });
    child.on('error', (e) => {
      this.spawnError = e;
      this.wake();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (e) => reject(e));
    });
    return child.pid as number;
  }

  /** 마지막 n줄(고리 버퍼). */
  tail(n = 200): string[] {
    return this.ring.slice(-n);
  }

  /** 종료를 기다린다(이미 종료면 즉시). 시간 안에 안 끝나면 false. */
  waitExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return withTimeout(
      new Promise<boolean>((resolve) => this.exitWaiters.push(() => resolve(true))),
      timeoutMs,
      false,
    );
  }

  /** 프로세스 트리 종료(taskkill /T /F) 후 종료 이벤트를 짧게 기다린다. */
  async stop(waitMs = 3000): Promise<{ killed: boolean }> {
    const pid = this.child?.pid;
    if (pid === undefined || this.exited) {
      this.closeLog();
      return { killed: false };
    }
    killTreeSync(pid);
    await this.waitExit(waitMs);
    this.closeLog();
    return { killed: true };
  }

  /** 동기 종료 — process 'exit' 핸들러용(비동기 불가). */
  stopSync(): void {
    const pid = this.child?.pid;
    if (pid !== undefined && !this.exited) killTreeSync(pid);
  }

  isAlive(): boolean {
    const pid = this.child?.pid;
    return pid !== undefined && !this.exited && isPidAlive(pid);
  }

  private onData(chunk: string): void {
    const text = this.spec.redact ? this.spec.redact(chunk) : chunk;
    this.log?.write(text);
    this.partial += text;
    let idx: number;
    while ((idx = this.partial.indexOf('\n')) >= 0) {
      this.pushLine(this.partial.slice(0, idx).replace(/\r$/, ''));
      this.partial = this.partial.slice(idx + 1);
    }
  }

  private flushPartial(): void {
    if (this.partial) this.pushLine(this.partial);
    this.partial = '';
  }

  private pushLine(line: string): void {
    this.ring.push(line);
    const max = this.spec.ringSize ?? 200;
    if (this.ring.length > max) this.ring.splice(0, this.ring.length - max);
  }

  private wake(): void {
    const ws = this.exitWaiters;
    this.exitWaiters = [];
    for (const w of ws) w();
  }

  private closeLog(): void {
    this.log?.end();
    this.log = null;
  }
}
