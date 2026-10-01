// 사전 점검 실행(설계 §5 P0 · §5.1) — 수집은 이 파일, 판정은 checks.ts(순수).
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { spawnSync } from 'node:child_process';
import { freemem, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliOptions } from '../cli/args';
import { harnessRoot, type Ports, type RepoPaths } from '../config';
import { probeBrowser } from '../browser/launch';
import { checkPorts } from '../proc/ports';
import { findPortOwners, netstatRows } from '../proc/system';
import { git } from '../build/fingerprint';
import { withTimeout } from '../util/wait-for';
import { DIST_PATHS } from '../build/fingerprint';
import {
  evalBrowserProbe,
  evalDependencies,
  evalDevDb,
  evalDisk,
  evalDistOutputs,
  evalEnvKeys,
  evalFfmpeg,
  evalGit,
  evalGpuInfo,
  evalMemory,
  evalModelCache,
  evalNetwork,
  evalNode,
  evalOllama,
  evalPnpm,
  evalPorts,
  evalVenv,
  parseEnvKeyNames,
  type FileFingerprint,
  type PcItem,
} from './checks';

export interface PreflightReport {
  items: PcItem[];
  blocked: boolean;
  /** Playwright 영상 인코더 사용 가능 여부(없으면 영상만 끈다). */
  videoAvailable: boolean;
  /** 외부망이 차단돼 있는지(보고서 점검표). */
  offline: boolean;
  devDbBefore: FileFingerprint;
  envKeyNames: { api: string[]; mlWorker: string[] };
}

/** HF 허브 캐시 위치 — `HF_HUB_CACHE` > `HF_HOME/hub` > `%USERPROFILE%/.cache/huggingface/hub`. */
export function hfHubDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
  if (env.HF_HOME) return join(env.HF_HOME, 'hub');
  return join(env.USERPROFILE ?? env.HOME ?? '', '.cache', 'huggingface', 'hub');
}

export function modelCacheState(hubDir: string): { snapshots: number; refsMain: boolean } {
  const base = join(hubDir, 'models--nlpai-lab--KURE-v1');
  let snapshots = 0;
  try {
    snapshots = readdirSync(join(base, 'snapshots')).length;
  } catch {
    /* 없음 */
  }
  return { snapshots, refsMain: existsSync(join(base, 'refs', 'main')) };
}

/** refs/main의 커밋 해시(오프라인 로드 실패 시 폴백에 쓴다 — 설계 §21.2 확인 1). */
export function readRefsMain(hubDir: string): string | null {
  try {
    const t = readFileSync(join(hubDir, 'models--nlpai-lab--KURE-v1', 'refs', 'main'), 'utf8').trim();
    return /^[0-9a-f]{40}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Playwright 브라우저 저장 위치 — `PLAYWRIGHT_BROWSERS_PATH` 또는 `%LOCALAPPDATA%\ms-playwright`. */
export function playwrightBrowsersPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
  return join(env.LOCALAPPDATA ?? join(env.USERPROFILE ?? '', 'AppData', 'Local'), 'ms-playwright');
}

/** `playwright-core/browsers.json`의 ffmpeg 리비전으로 정확한 폴더를 구한다(버전 짝 — 설계 §19). */
export function expectedFfmpegDir(): { dir: string; revision: string | null } {
  let revision: string | null = null;
  try {
    const j = JSON.parse(readFileSync(join(harnessRoot(), 'node_modules', 'playwright-core', 'browsers.json'), 'utf8')) as {
      browsers: Array<{ name: string; revision: string }>;
    };
    revision = j.browsers.find((b) => b.name === 'ffmpeg')?.revision ?? null;
  } catch {
    /* 해석 불가 */
  }
  return { dir: join(playwrightBrowsersPath(), `ffmpeg-${revision ?? '?'}`), revision };
}

export function ffmpegPresent(): { present: boolean; dir: string } {
  const { dir } = expectedFfmpegDir();
  const exe = join(dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux');
  return { present: existsSync(exe), dir };
}

function fileFingerprint(path: string): FileFingerprint {
  try {
    const st = statSync(path);
    return { exists: true, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
  } catch {
    return { exists: false };
  }
}
export { fileFingerprint };

function readKeyNames(path: string): string[] | null {
  try {
    return parseEnvKeyNames(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function freeBytesOf(dir: string): number | null {
  try {
    // 아직 없는 폴더면 존재하는 가장 가까운 상위 폴더로
    let probe = dir;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    const s = statfsSync(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

async function networkOpen(): Promise<{ dnsOk: boolean; tcpOk: boolean }> {
  const dnsP = withTimeout(lookup('example.com').then(() => true, () => false), 3000, false);
  const tcpP = new Promise<boolean>((resolve) => {
    const s = connect({ host: '1.1.1.1', port: 443 });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(3000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
  const [dnsOk, tcpOk] = await Promise.all([dnsP, tcpP]);
  return { dnsOk, tcpOk };
}

function missingDeps(paths: RepoPaths): string[] {
  const missing: string[] = [];
  const need: Array<[string, string]> = [
    ['하네스 node_modules', join(paths.harness, 'node_modules')],
    ['playwright-core', join(paths.harness, 'node_modules', 'playwright-core', 'package.json')],
    ['@chat-bot/shared-types 링크', join(paths.harness, 'node_modules', '@chat-bot', 'shared-types')],
    ['apps/api node_modules', join(paths.apiDir, 'node_modules')],
    ['Prisma CLI', join(paths.apiDir, 'node_modules', 'prisma', 'build', 'index.js')],
  ];
  for (const [label, p] of need) if (!existsSync(p)) missing.push(label);
  return missing;
}

function nvidiaSmi(): string[] | null {
  const r = spawnSync('nvidia-smi', ['-L'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export async function runPreflight(args: {
  paths: RepoPaths;
  options: CliOptions;
  ports: Ports;
  runsDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreflightReport> {
  const { paths, options, ports, runsDir } = args;
  const env = args.env ?? process.env;
  const items: PcItem[] = [];

  items.push(evalNode(process.version));
  items.push(evalPnpm(env.npm_execpath));
  items.push(evalDependencies(missingDeps(paths)));
  items.push(evalVenv(existsSync(paths.venvPython), paths.venvPython));
  const hub = hfHubDir(env);
  const mc = modelCacheState(hub);
  items.push(evalModelCache(mc.snapshots, mc.refsMain, hub));

  const missingDist = DIST_PATHS.filter((p) => !existsSync(join(paths.repo, p)));
  items.push(evalDistOutputs([...missingDist], options.noBuild));

  // PC-5 브라우저 — 기동까지 해 본다
  if (options.browser === 'none' && options.mode === 'visible') {
    items.push({ id: 'PC-5', title: '브라우저', status: 'block', message: '--browser none은 무인 점검에서만 쓸 수 있습니다', why: '보이는 시연에는 브라우저가 필요합니다', how: '--browser msedge  또는  pnpm demo:check -- --browser none' });
  } else {
    const probe = await probeBrowser(options.browser);
    items.push(evalBrowserProbe(probe.ok, probe.kind, probe.detail, probe.version));
  }

  const ff = ffmpegPresent();
  const videoWanted = options.mode === 'visible' && !options.noVideo;
  items.push(evalFfmpeg(ff.present, ff.dir, videoWanted));

  items.push(evalDisk(freeBytesOf(runsDir), runsDir));

  const portChecks = await checkPorts(ports);
  const rows = portChecks.some((c) => !c.free) ? netstatRows() : [];
  const owners = portChecks.filter((c) => !c.free).flatMap((c) => findPortOwners(c.port, rows));
  items.push(evalPorts(portChecks, owners));

  const net = await networkOpen();
  const netItem = evalNetwork(net.dnsOk, net.tcpOk, options.requireOffline);
  items.push(netItem);

  const ollamaPort = netstatRows().some((r) => r.state === 'LISTENING' && r.localPort === 11434);
  let ollamaProc = false;
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ollama.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    ollamaProc = /"ollama\.exe"/i.test(r.stdout ?? '');
  }
  items.push(evalOllama(ollamaProc, ollamaPort));

  items.push(...evalMemory(totalmem(), freemem()));
  items.push(evalGpuInfo(nvidiaSmi()));
  const sha = git(paths.repo, ['rev-parse', 'HEAD']);
  const dirty = git(paths.repo, ['status', '--porcelain']);
  items.push(evalGit(sha.ok ? sha.out : null, sha.ok ? dirty.out.length > 0 : null));
  const devDbBefore = fileFingerprint(paths.devDb);
  items.push(evalDevDb(devDbBefore));
  const apiKeys = readKeyNames(join(paths.apiDir, '.env'));
  const mlKeys = readKeyNames(join(paths.mlWorkerDir, '.env'));
  items.push(evalEnvKeys(apiKeys, mlKeys));

  return {
    items,
    blocked: items.some((i) => i.status === 'block'),
    videoAvailable: ff.present,
    offline: netItem.data?.offline === true,
    devDbBefore,
    envKeyNames: { api: apiKeys ?? [], mlWorker: mlKeys ?? [] },
  };
}
