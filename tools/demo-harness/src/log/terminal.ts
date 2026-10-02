// 진행자 터미널 출력(ui-spec §9) — 대괄호 라벨(색 비의존) · ASCII 골격 · 한글 표시 폭 · TTY/비TTY 분기 ·
// 오류 3요소(무엇이/왜/어떻게). 같은 내용을 비밀 제거 후 harness.log에도 남긴다(색 코드·제자리 갱신 없음).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { displayWidth, dotLeader, wrapByWidth } from '../util/display-width';
import { formatClock } from '../util/time';

export type Label = 'pass' | 'fail' | 'skip' | 'fallback' | 'delay' | 'warn' | 'error' | 'info' | 'progress';

export const LABEL_TEXT: Record<Label, string> = {
  pass: '[통과]',
  fail: '[실패]',
  skip: '[건너뜀]',
  fallback: '[대체]',
  delay: '[지연]',
  warn: '[주의]',
  error: '[오류]',
  info: '[정보]',
  progress: '[진행]',
};

const ANSI: Record<Label, string> = {
  pass: '32',
  fail: '31',
  skip: '33',
  fallback: '36',
  delay: '33',
  warn: '33',
  error: '31',
  info: '36',
  progress: '36',
};

export interface OutputSink {
  write(s: string): unknown;
  isTTY?: boolean;
}

export interface TerminalOptions {
  out?: OutputSink;
  /** ANSI 색(라벨 글자만) — TTY이고 NO_COLOR·--no-color가 아닐 때만 켠다. */
  color?: boolean;
  verbose?: boolean;
  logFile?: string;
  /** 비밀 제거(Redactor.redact) — 터미널·로그 파일 모두에 적용. */
  redact?: (s: string) => string;
  width?: number;
  /** 시험용 시계. */
  now?: () => Date;
}

export type StepStatus = '완료' | '진행' | '대기' | '생략' | '실패';

export interface Detail {
  why?: string;
  how?: string;
}

export class Terminal {
  readonly width: number;
  private readonly out: OutputSink;
  private readonly color: boolean;
  private readonly verboseOn: boolean;
  private readonly logFile?: string;
  private readonly redact: (s: string) => string;
  private readonly now: () => Date;

  constructor(opts: TerminalOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.verboseOn = opts.verbose ?? false;
    this.logFile = opts.logFile;
    this.redact = opts.redact ?? ((s) => s);
    this.width = opts.width ?? 78;
    this.now = opts.now ?? (() => new Date());
    this.color = opts.color ?? false;
    if (this.logFile) mkdirSync(dirname(this.logFile), { recursive: true });
    // 출력 파이프가 닫혀도(EPIPE) 하네스가 죽지 않게 한다 — 정리 단계가 반드시 끝까지 돌아야 한다.
    (this.out as unknown as { on?: (ev: string, fn: () => void) => void }).on?.('error', () => undefined);
  }

  /** stdout 상태에 맞는 기본 설정으로 만든다(NO_COLOR · --no-color · 비TTY이면 색 0). */
  static forProcess(opts: { noColor: boolean; verbose: boolean; logFile?: string; redact?: (s: string) => string }): Terminal {
    const tty = Boolean(process.stdout.isTTY);
    const color = tty && !opts.noColor && process.env.NO_COLOR === undefined;
    return new Terminal({ out: process.stdout, color, verbose: opts.verbose, logFile: opts.logFile, redact: opts.redact });
  }

  get isInteractive(): boolean {
    return Boolean(this.out.isTTY) && Boolean(process.stdin.isTTY);
  }

  /** 라벨이 붙은 한 건. why/how가 있으면 3요소 형식(왜:/조치: 접두)으로 이어 붙인다. */
  line(label: Label, message: string, detail: Detail = {}): void {
    const tag = LABEL_TEXT[label];
    const indent = ' '.repeat(displayWidth(tag) + 1);
    const lines: string[] = [];
    const head = wrapByWidth(`${tag} ${message}`, this.width, indent);
    lines.push(...head);
    if (detail.why) lines.push(...wrapByWidth(`${indent}왜: ${detail.why}`, this.width, `${indent}    `));
    if (detail.how) lines.push(...wrapByWidth(`${indent}조치: ${detail.how}`, this.width, `${indent}      `));
    this.emit(lines, (first) => this.paintLabel(first, label, tag));
  }

  /** 라벨 없는 일반 줄(들여쓰기 유지, 폭 기준 줄바꿈). */
  text(message: string, indent = ''): void {
    this.emit(wrapByWidth(message, this.width, indent));
  }

  /** `--verbose`에서만 터미널에 나온다(로그 파일에는 항상 기록). */
  detail(message: string): void {
    const lines = wrapByWidth(`      ${message}`, this.width, '        ');
    if (this.verboseOn) this.emit(lines);
    else this.fileOnly(lines);
  }

  /**
   * 터미널에만 쓰는 줄 — 비밀 제거(redact)와 로그 파일 기록을 모두 건너뛴다.
   * 계정 비밀번호는 준비 완료 요약에만 1회 출력하고 로그·보고서·캡처에는 남기지 않는다(NFR-DHS3).
   */
  secretLine(message: string, indent = ''): void {
    try {
      this.out.write(wrapByWidth(message, this.width, indent).join('\n') + '\n');
    } catch {
      /* 출력 파이프가 닫혔다 */
    }
  }

  blank(): void {
    this.emit(['']);
  }

  /** `== 제목 ==` 구분선. */
  banner(title: string): void {
    this.emit([`== ${title} ==`]);
  }

  rule(char: '=' | '-' = '='): void {
    this.emit([char.repeat(this.width - 2)]);
  }

  /** `[n/N] 이름 ..... 상태 (mm:ss)` — 상태 어휘 완료·진행·대기·생략·실패(ui-spec §9.2). */
  stepLine(n: number, total: number, name: string, status: StepStatus, elapsed?: string): void {
    const right = elapsed ? `${status} (${elapsed})` : status;
    this.emit([dotLeader(`[${n}/${total}] ${name}`, right, this.width)]);
  }

  private paintLabel(line: string, label: Label, tag: string): string {
    if (!this.color || !line.startsWith(tag)) return line;
    return `\u001b[${ANSI[label]}m${tag}\u001b[0m${line.slice(tag.length)}`;
  }

  private emit(lines: string[], paintFirst?: (first: string) => string): void {
    const clean = lines.map((l) => this.redact(l));
    const shown = paintFirst && clean.length > 0 ? [paintFirst(clean[0]), ...clean.slice(1)] : clean;
    try {
      this.out.write(shown.join('\n') + '\n');
    } catch {
      /* 출력 파이프가 닫혔다(예: pnpm demo | head) — 진행·정리를 막지 않고 로그 파일에만 남긴다 */
    }
    this.fileOnly(clean);
  }

  private fileOnly(lines: string[]): void {
    if (!this.logFile) return;
    const stamp = formatClock(this.now());
    const body = lines.map((l) => `${stamp} ${this.redact(l)}`).join('\n') + '\n';
    try {
      appendFileSync(this.logFile, body, 'utf8');
    } catch {
      /* 로그 실패는 진행을 막지 않는다 */
    }
  }
}
