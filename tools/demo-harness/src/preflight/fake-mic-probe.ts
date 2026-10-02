// [DT-2] PC-DX-6·8 — 별도 헤드리스 브라우저로 가짜 마이크와 기기 안 한국어 읽기 음성을 점검한다(설계 §5.1).
// 임시 루프백 서버(`127.0.0.1:<임시 포트>/probe` — 보안 컨텍스트)에서 `getUserMedia` → `MediaRecorder` 1.5초 → 바이트 > 0.
// 공연 브라우저와 **다른 프로세스**라 가짜 오디오 파일을 공연 전에 소비하지 않는다(DX-1로 완화됐지만 점검은 계속 분리한다).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { fakeMediaArgs } from '../browser/fake-media';
import { planBrowserLaunch } from '../browser/launch';

export interface FakeMicProbeResult {
  ok: boolean;
  secure: boolean;
  bytes: number;
  mime: string;
  error: string;
  /** 브라우저가 보고한 읽기 음성 총수 · 기기 안(localService) 한국어 음성 수 — PC-DX-8. */
  voices: number;
  localKo: number;
  /** 점검 자체가 실패한 이유(브라우저 기동 불가 등). */
  failure?: string;
}

export async function probeFakeMic(o: { browser: string; assetsDir: string; wavPath: string; timeoutMs?: number }): Promise<FakeMicProbeResult> {
  const timeoutMs = o.timeoutMs ?? 30_000;
  const plan = planBrowserLaunch(o.browser);
  const empty: FakeMicProbeResult = { ok: false, secure: false, bytes: 0, mime: '', error: '', voices: 0, localKo: 0 };
  if (plan.kind === 'none') return { ...empty, failure: '브라우저 없음(--browser none)' };
  const html = readFileSync(join(o.assetsDir, 'mic-probe.html'), 'utf8');
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/probe')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true, channel: plan.channel, executablePath: plan.executablePath, args: fakeMediaArgs(o.wavPath), timeout: timeoutMs });
    // 점검 전용 컨텍스트는 마이크 권한을 전역으로 준다(공연 브라우저는 출처 한정 부여 — 설계 §8.1)
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/probe`, { timeout: timeoutMs });
    const handle = await page.waitForFunction(() => (window as unknown as { __probe?: unknown }).__probe, undefined, { timeout: timeoutMs, polling: 250 });
    const r = (await handle.jsonValue()) as Omit<FakeMicProbeResult, 'failure'>;
    return { ...empty, ...r };
  } catch (e) {
    return { ...empty, failure: (e as Error).message.split('\n')[0] };
  } finally {
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
