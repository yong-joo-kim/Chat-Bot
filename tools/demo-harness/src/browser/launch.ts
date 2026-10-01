// 브라우저 기동 선택(설계 §8.1) — `--browser` 값을 Playwright 실행 옵션으로 바꾸고, 폴백 사다리 안내를 만든다.
// 사다리: msedge(기본) -> chrome -> 지정 실행 파일 -> chromium(반입) -> none(무인 점검 전용, 브라우저 없이 API 검증).
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

export interface BrowserLaunchPlan {
  kind: 'msedge' | 'chrome' | 'chromium' | 'executable' | 'none';
  channel?: 'msedge' | 'chrome';
  executablePath?: string;
}

export function planBrowserLaunch(choice: string): BrowserLaunchPlan {
  switch (choice) {
    case 'msedge':
      return { kind: 'msedge', channel: 'msedge' };
    case 'chrome':
      return { kind: 'chrome', channel: 'chrome' };
    case 'chromium':
      return { kind: 'chromium' };
    case 'none':
      return { kind: 'none' };
    default:
      return { kind: 'executable', executablePath: choice };
  }
}

export interface BrowserProbeResult {
  ok: boolean;
  kind: BrowserLaunchPlan['kind'];
  version?: string;
  detail: string;
  elapsedMs: number;
}

/** PC-5: 지정 브라우저를 headless로 띄워 `data:` 페이지를 열고 스크린샷 1장을 찍은 뒤 닫는다(상한 20초). */
export async function probeBrowser(choice: string, timeoutMs = 20_000): Promise<BrowserProbeResult> {
  const plan = planBrowserLaunch(choice);
  const t0 = Date.now();
  if (plan.kind === 'none') return { ok: true, kind: 'none', detail: '브라우저 없이 API 검증만(무인 점검 전용)', elapsedMs: 0 };
  if (plan.kind === 'executable' && plan.executablePath && !existsSync(plan.executablePath)) {
    return { ok: false, kind: plan.kind, detail: `실행 파일이 없습니다: ${plan.executablePath}`, elapsedMs: 0 };
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: plan.channel,
      executablePath: plan.executablePath,
      timeout: timeoutMs,
    });
    const page = await browser.newPage();
    await page.goto('data:text/html,<title>probe</title><h1>probe</h1>', { timeout: timeoutMs });
    const shot = await page.screenshot({ timeout: timeoutMs });
    if (shot.length < 100) throw new Error('스크린샷이 비어 있습니다');
    return { ok: true, kind: plan.kind, version: browser.version(), detail: `기동·페이지 조작·스크린샷 성공`, elapsedMs: Date.now() - t0 };
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    return { ok: false, kind: plan.kind, detail: msg, elapsedMs: Date.now() - t0 };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** 영속 컨텍스트용 프로필 폴더 보장(실행 폴더 안 새 프로필 — 사용자 Edge 프로필 미사용, NFR-DHS2). */
export function ensureProfileDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
