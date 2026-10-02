// 진행자 제어(설계 §4.4 · ui-spec §9.3~§9.4) — Enter(시작) · Space/p(일시정지) · n(현재 단계 건너뛰기) · s(다음 구간) · q(종료 확인 후 정리).
// 터미널이 TTY면 키를 바로 받고, 아니면(Git Bash mintty 등) 줄 명령(입력 후 엔터)으로 받는다. 키 해석은 순수 함수라 단위 시험으로 검증한다.
import { EventEmitter } from 'node:events';

export type PresenterKey = 'ENTER' | 'PAUSE' | 'SKIP_STEP' | 'NEXT_SEGMENT' | 'QUIT' | 'YES' | 'INTERRUPT' | 'OTHER';

/** 원시 키 입력(TTY) 한 덩어리를 키 목록으로 바꾼다. */
export function interpretKeys(data: string): PresenterKey[] {
  const out: PresenterKey[] = [];
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') out.push('ENTER');
    else if (ch === ' ') out.push('PAUSE');
    else if (ch === 'n' || ch === 'N') out.push('SKIP_STEP');
    else if (ch === 's' || ch === 'S') out.push('NEXT_SEGMENT');
    else if (ch === 'q' || ch === 'Q') out.push('QUIT');
    else if (ch === 'y' || ch === 'Y') out.push('YES');
    else if (ch === '\u0003') out.push('INTERRUPT');
    else out.push('OTHER');
  }
  return out;
}

/** 줄 명령(비TTY) 한 줄을 키로 바꾼다 — 빈 줄은 엔터. */
export function interpretLine(line: string): PresenterKey {
  const t = line.trim().toLowerCase();
  if (t === '') return 'ENTER';
  if (t === 'p') return 'PAUSE';
  if (t === 'n') return 'SKIP_STEP';
  if (t === 's') return 'NEXT_SEGMENT';
  if (t === 'q') return 'QUIT';
  if (t === 'y') return 'YES';
  return 'OTHER';
}

export interface PresenterInput {
  on(event: 'data' | 'end' | 'close', fn: (chunk?: Buffer | string) => void): unknown;
  removeListener(event: string, fn: (...a: unknown[]) => void): unknown;
  setEncoding?(enc: string): unknown;
  setRawMode?(on: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
}

export interface PresenterOptions {
  mode: 'keys' | 'lines';
  input: PresenterInput;
  /** 진행자에게 한 줄 안내(터미널 `[정보]`·`[확인]`). */
  say: (kind: 'info' | 'confirm' | 'warn', text: string) => void;
  /** 종료 확인(q → y)이 끝났을 때 — 정리 후 종료 코드 130. */
  onQuit: () => void;
  /** 원시 모드의 Ctrl+C(OS가 SIGINT를 보내지 않는다) — 같은 정리 경로로 보낸다. */
  onInterrupt: () => void;
}

export interface CurrentStepInfo {
  stepId: string;
  /** 지금 생략할 수 있는가(핵심이거나 승격된 단계면 false). */
  skippable: boolean;
}

/** 키 → 상태 변화. 부수효과(터미널 안내)는 `say`로만 낸다. */
export class PresenterControl extends EventEmitter {
  paused = false;
  started = false;
  private finishing = false;
  private pendingQuit = false;
  private skipStepFlag = false;
  private skipSegmentFlag = false;
  private current: CurrentStepInfo | null = null;
  private startResolvers: Array<() => void> = [];
  private finishResolvers: Array<() => void> = [];
  private attached = false;
  private lineBuffer = '';
  private readonly onData = (chunk?: Buffer | string): void => this.handleData(String(chunk ?? ''));
  private readonly onEnd = (): void => this.handleEnd();

  constructor(private readonly opts: PresenterOptions) {
    super();
  }

  /** 입력 구독 시작. 원시 모드면 raw를 켠다. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const inp = this.opts.input;
    inp.setEncoding?.('utf8');
    if (this.opts.mode === 'keys') inp.setRawMode?.(true);
    inp.resume?.();
    inp.on('data', this.onData);
    inp.on('end', this.onEnd);
    inp.on('close', this.onEnd);
  }

  /** 입력 구독 해제(원시 모드 원복) — 정리 단계에서 반드시 호출한다. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const inp = this.opts.input;
    inp.removeListener('data', this.onData as (...a: unknown[]) => void);
    inp.removeListener('end', this.onEnd as (...a: unknown[]) => void);
    inp.removeListener('close', this.onEnd as (...a: unknown[]) => void);
    if (this.opts.mode === 'keys') inp.setRawMode?.(false);
    inp.pause?.();
  }

  /** 공연 중인 단계 정보(핵심이면 `n` 무시 안내에 쓴다). */
  setCurrent(info: CurrentStepInfo | null): void {
    this.current = info;
  }

  /** 엔터를 누를 때까지 기다린다(이미 시작했으면 즉시). */
  waitForStart(signal?: AbortSignal): Promise<void> {
    if (this.started) return Promise.resolve();
    return new Promise((resolve) => {
      this.startResolvers.push(resolve);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  /** 공연이 끝난 뒤 `q`(확인 없이)를 기다린다. */
  waitForFinish(signal?: AbortSignal): Promise<void> {
    this.finishing = true;
    return new Promise((resolve) => {
      this.finishResolvers.push(resolve);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  /** 일시정지 중 흐른 시간을 호출자가 센다 — 이 클래스는 상태만 안다. */
  consumeSkipStep(): boolean {
    const v = this.skipStepFlag;
    this.skipStepFlag = false;
    return v;
  }

  consumeSkipSegment(): boolean {
    const v = this.skipSegmentFlag;
    this.skipSegmentFlag = false;
    return v;
  }

  /** 키 하나를 처리한다(시험에서 직접 호출). */
  press(key: PresenterKey): void {
    const say = this.opts.say;
    if (key === 'INTERRUPT') {
      this.opts.onInterrupt();
      return;
    }
    if (this.pendingQuit) {
      this.pendingQuit = false;
      if (key === 'YES') {
        say('info', '종료합니다. 정리를 시작합니다');
        this.opts.onQuit();
      } else say('info', '계속합니다');
      return;
    }
    if (this.finishing) {
      if (key === 'QUIT') for (const r of this.finishResolvers.splice(0)) r();
      return;
    }
    switch (key) {
      case 'ENTER':
        if (!this.started) {
          this.started = true;
          for (const r of this.startResolvers.splice(0)) r();
        }
        return;
      case 'PAUSE':
        if (!this.started) return;
        this.paused = !this.paused;
        say('info', this.paused ? '일시정지합니다(다시 누르면 재개)' : '재개합니다');
        this.emit('pause', this.paused);
        return;
      case 'SKIP_STEP':
        if (!this.started) return;
        if (!this.current) {
          say('info', '지금은 건너뛸 단계가 없습니다');
          return;
        }
        if (!this.current.skippable) {
          say('info', `핵심 장면은 건너뛸 수 없습니다 (${this.current.stepId})`);
          return;
        }
        this.skipStepFlag = true;
        this.emit('skip');
        return;
      case 'NEXT_SEGMENT':
        if (!this.started) return;
        this.skipSegmentFlag = true;
        this.emit('segment');
        return;
      case 'QUIT':
        this.pendingQuit = true;
        say('confirm', '시연을 종료하고 정리할까요? y = 종료 / 그 외 = 계속');
        return;
      default:
        return;
    }
  }

  private handleData(text: string): void {
    if (this.opts.mode === 'keys') {
      for (const k of interpretKeys(text)) this.press(k);
      return;
    }
    this.lineBuffer += text.replace(/\r/g, '');
    let nl = this.lineBuffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      this.press(interpretLine(line));
      nl = this.lineBuffer.indexOf('\n');
    }
  }

  /** 표준 입력이 닫혔다 — 엔터를 기다리던 중이면 자동 시작(안내), 마무리를 기다리던 중이면 종료. */
  private handleEnd(): void {
    if (!this.started) {
      this.opts.say('warn', '표준 입력이 닫혀 있어 자동으로 시작합니다(엔터 대기 생략)');
      this.started = true;
      for (const r of this.startResolvers.splice(0)) r();
    }
    for (const r of this.finishResolvers.splice(0)) r();
  }
}

/** 키 안내 줄(상시 표시용 — ui-spec §9.4). 모드에 따라 키 또는 줄 명령 문구. */
export function keyHelpLine(mode: 'keys' | 'lines'): string {
  return mode === 'keys'
    ? 'Space 일시정지  n 이 단계 건너뛰기  s 다음 장면으로  q 종료(확인 후 정리)'
    : '줄 명령: p=일시정지  n=건너뛰기  s=다음 장면  q=종료 - 입력 후 엔터를 누르세요';
}
