// 브라우저 세션(설계 §8) — 영속 컨텍스트 1개(실행 폴더 안 새 프로필) · 무대 페이지 1장 · 계정 쿠키 교체 · 외부 요청 차단·기록 · 대화상자 감시.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type BrowserContext, type Dialog, type FrameLocator, type Page } from 'playwright-core';
import { planBrowserLaunch } from './launch';

export interface BlockedRequest {
  /** ISO 시각 */
  at: string;
  host: string;
  stepId: string | null;
  frameUrl: string;
}

export interface BrowserSessionOptions {
  browser: string;
  profileDir: string;
  viewport: { width: number; height: number };
  headless: boolean;
  stageUrl: string;
  /** 영상 저장 폴더 — 인코더가 있을 때만 넘긴다(없으면 기동이 실패한다). */
  recordVideoDir?: string;
  consoleLogFile?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class BrowserSession {
  readonly blocked: BlockedRequest[] = [];
  readonly unexpectedDialogs: string[] = [];
  readonly consoleErrors: string[] = [];
  currentStepId: string | null = null;
  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly opts: BrowserSessionOptions,
  ) {}

  static async launch(opts: BrowserSessionOptions): Promise<BrowserSession> {
    const plan = planBrowserLaunch(opts.browser);
    if (plan.kind === 'none') throw new Error('브라우저 없음(--browser none) 모드에서는 세션을 만들 수 없습니다');
    mkdirSync(opts.profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(opts.profileDir, {
      channel: plan.channel,
      executablePath: plan.executablePath,
      headless: opts.headless,
      viewport: opts.viewport,
      deviceScaleFactor: 1,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      acceptDownloads: false,
      recordVideo: opts.recordVideoDir ? { dir: opts.recordVideoDir, size: opts.viewport } : undefined,
      args: opts.headless ? [] : ['--start-maximized'],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const s = new BrowserSession(context, page, opts);
    await s.install();
    return s;
  }

  private async install(): Promise<void> {
    // DHD-13: 비루프백 요청은 차단하고 기록한다(폐쇄망과 같은 화면 · 외부 요청 증거)
    await this.context.route('**/*', async (route) => {
      const req = route.request();
      let host = '';
      let protocol = '';
      try {
        const u = new URL(req.url());
        host = u.hostname;
        protocol = u.protocol;
      } catch {
        /* 해석 불가 */
      }
      if (LOOPBACK.has(host) || ['data:', 'blob:', 'about:'].includes(protocol)) return route.continue();
      this.blocked.push({ at: new Date().toISOString(), host, stepId: this.currentStepId, frameUrl: req.frame()?.url() ?? '' });
      return route.abort('blockedbyclient');
    });
    // beforeunload는 수락(단계 이동 우선), 그 밖의 네이티브 대화상자는 예상 밖 — 기록하고 닫는다(제품 콘솔은 자체 ConfirmDialog를 쓴다)
    this.page.on('dialog', (d: Dialog) => {
      if (d.type() === 'beforeunload') {
        void d.accept();
        return;
      }
      this.unexpectedDialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`);
      void d.dismiss();
    });
    this.page.on('console', (m) => {
      if (m.type() === 'error') this.log(`console.error: ${m.text().slice(0, 300)}`);
    });
    this.page.on('pageerror', (e) => this.log(`pageerror: ${String(e).slice(0, 300)}`));
  }

  private log(line: string): void {
    this.consoleErrors.push(line);
    if (this.consoleErrors.length > 200) this.consoleErrors.shift();
    if (this.opts.consoleLogFile) {
      try {
        mkdirSync(dirname(this.opts.consoleLogFile), { recursive: true });
        appendFileSync(this.opts.consoleLogFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
      } catch {
        /* 로그 실패는 진행을 막지 않는다 */
      }
    }
  }

  get consoleFrame(): FrameLocator {
    return this.page.frameLocator('#console');
  }

  get siteFrame(): FrameLocator {
    return this.page.frameLocator('#site');
  }

  /** 무대 페이지를 연다(`#ready` 상태로 시작). */
  async openStage(): Promise<void> {
    await this.page.goto(this.opts.stageUrl, { waitUntil: 'load' });
    await this.page.waitForFunction(() => typeof (window as unknown as { __stage?: unknown }).__stage === 'object');
  }

  /** 세션 쿠키 교체(설계 §8.3) — 실제 로그인으로 받은 값만 넣는다. */
  async setSessionCookie(value: string): Promise<void> {
    await this.context.clearCookies({ name: 'cb_session' });
    await this.context.addCookies([{ name: 'cb_session', value, domain: 'localhost', path: '/api', httpOnly: true, sameSite: 'Lax' }]);
  }

  /** 지금까지의 차단 호스트별 횟수(보고서 외부 송신 점검표 "브라우저" 칸). */
  blockedSummary(): Array<{ host: string; count: number; firstStepId: string | null }> {
    const m = new Map<string, { count: number; firstStepId: string | null }>();
    for (const b of this.blocked) {
      const cur = m.get(b.host);
      if (cur) cur.count++;
      else m.set(b.host, { count: 1, firstStepId: b.stepId });
    }
    return [...m.entries()].map(([host, v]) => ({ host, ...v }));
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

/** window.__stage 호출 래퍼 — 무대 상태·자막·창 이동. */
export class StageController {
  constructor(private readonly page: Page) {}

  private call<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(
      ([name, a]) => {
        const st = (window as unknown as { __stage: Record<string, (...x: unknown[]) => unknown> }).__stage;
        return st[name as string](...(a as unknown[]));
      },
      [fn, args] as [string, unknown[]],
    ) as Promise<T>;
  }

  setLayout(name: 'card' | 'split' | 'console'): Promise<void> {
    return this.call('setLayout', name);
  }
  setSegment(chip: string, title: string): Promise<void> {
    return this.call('setSegment', chip, title);
  }
  setTimer(s: { elapsedMs: number; paused: boolean; totalSec?: number; ended?: boolean }): Promise<void> {
    return this.call('setTimer', s);
  }
  setProgress(fractions: number[]): Promise<void> {
    return this.call('setProgress', fractions);
  }
  setPaneLabel(which: 'site' | 'console', text: string): Promise<void> {
    return this.call('setPaneLabel', which, text);
  }
  /** iframe 이동 + load 대기(20초 상한, 초과면 false). */
  navigate(which: 'site' | 'console', url: string): Promise<boolean> {
    return this.call('navigate', which, url);
  }
  showCard(kind: 'system' | 'system-end' | 'roadmap'): Promise<void> {
    return this.call('showCard', kind);
  }
  showCaption(c: { lines: string[]; notice?: string; badges?: string[] }): Promise<void> {
    return this.call('showCaption', c);
  }
  clearCaption(): Promise<void> {
    return this.call('clearCaption');
  }
  pauseCaption(on: boolean): Promise<void> {
    return this.call('pauseCaption', on);
  }
  setStateChip(state: 'none' | 'paused' | 'fallback' | 'failed'): Promise<void> {
    return this.call('setStateChip', state);
  }
  setReady(on: boolean): Promise<void> {
    return this.call('setReady', on);
  }
  setFinishing(): Promise<void> {
    return this.call('setFinishing');
  }
}
