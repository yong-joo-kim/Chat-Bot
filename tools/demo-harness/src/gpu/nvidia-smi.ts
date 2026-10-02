// [DT-2] `nvidia-smi` 호출·파서·VRAM 회수 판정(설계 §11.2 · §11.4 · 정적 검사 H-S6 — nvidia-smi 실행은 src/gpu/ 에만).
// CSV 출력(`--format=csv,noheader,nounits`)이라 코드 페이지와 무관하다. VRAM 수치는 **관찰**이며 합격 판정에 쓰지 않는다(FR-0-352) —
// 회수 판정은 "다음 동작을 해도 되는가"의 운영 게이트일 뿐이다.
import { spawn, spawnSync } from 'node:child_process';
import { sleepMs } from '../util/wait-for';

export interface GpuMemory {
  usedMiB: number;
  totalMiB: number;
}

/** `memory.used, memory.total` CSV(예: "1020, 4096") → 첫 GPU. `[N/A]`·빈 출력·형식 오류는 null. */
export function parseMemoryCsv(text: string): GpuMemory | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const used = Number(parts[0]);
    const total = Number(parts[1]);
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
    return { usedMiB: used, totalMiB: total };
  }
  return null;
}

/** `--query-compute-apps=pid,...` CSV → PID 목록(프로세스별 VRAM은 WDDM에서 `[N/A]`라 쓰지 않는다 — 실측 X-5). */
export function parseComputeAppPids(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /no running processes/i.test(line)) continue;
    const pid = Number(line.split(',')[0]?.trim());
    if (Number.isInteger(pid) && pid > 0) out.push(pid);
  }
  return out;
}

/** `nvidia-smi -L` 출력 → GPU 줄 목록. */
export function parseGpuList(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function run(args: string[], timeoutMs = 5000): { ok: boolean; out: string } {
  const r = spawnSync('nvidia-smi', args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
  if (r.error || r.status !== 0) return { ok: false, out: '' };
  return { ok: true, out: r.stdout ?? '' };
}

/** 비동기 조회(관찰기용 — 공연 중 이벤트 루프를 막지 않는다). 실패·시간 초과는 null. */
function runAsync(args: string[], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      // 시간 초과는 spawn의 timeout 옵션(SIGTERM)에 맡긴다 — setTimeout은 쓰지 않는다(H-S2)
      const child = spawn('nvidia-smi', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (d: string) => (out += d));
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code === 0 ? out : null));
    } catch {
      finish(null);
    }
  });
}

/** `nvidia-smi -L` — GPU 줄 목록(nvidia-smi가 없거나 실패면 null). */
export function queryGpuList(): string[] | null {
  const r = run(['-L']);
  return r.ok ? parseGpuList(r.out) : null;
}

/** 전체 GPU 메모리 사용량(첫 GPU) — 조회 실패면 null. */
export function queryGpuMemory(): GpuMemory | null {
  const r = run(['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits']);
  return r.ok ? parseMemoryCsv(r.out) : null;
}

/** 비동기 GPU 메모리 조회(첫 GPU). */
export async function queryGpuMemoryAsync(): Promise<GpuMemory | null> {
  const out = await runAsync(['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits']);
  return out === null ? null : parseMemoryCsv(out);
}

/** 비동기 GPU 앱 PID 조회(회수 폴링용 — 이벤트 루프를 막지 않는다 · L-2). */
export async function queryComputeAppPidsAsync(): Promise<number[] | null> {
  const out = await runAsync(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']);
  return out === null ? null : parseComputeAppPids(out);
}

/** 지금 GPU를 쓰는 프로세스 PID 목록(조회 실패면 null). */
export function queryComputeAppPids(): number[] | null {
  const r = run(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']);
  return r.ok ? parseComputeAppPids(r.out) : null;
}

export interface ReclaimInput {
  /** 종료한 프로세스 트리의 PID(런처 + 인터프리터 — DX-6). 아직 GPU 앱 목록에 있는 PID가 있으면 회수 전. */
  watchedPids: number[];
  /** 지금 GPU 앱 목록(조회 실패면 null → PID 조건은 보지 않는다). */
  appPids: number[] | null;
  usedMiB: number | null;
  /** 종료 직전 사용량. */
  beforeMiB: number | null;
  /** 적재로 늘어난 양(없거나 모르면 null → 메모리 조건은 하락 여부만 본다). */
  increaseMiB: number | null;
  /** STT가 CPU로 구동됐다(GPU 메모리 하락을 기대하지 않는다 — H-1). */
  cpuDevice?: boolean;
  /** 증가분 중 이만큼 이상 내려가야 회수로 본다(기본 0.7 — 설계 §11.2). */
  fraction?: number;
}

export interface ReclaimJudgement {
  ok: boolean;
  pidsGone: boolean;
  memoryOk: boolean;
  /** 판정 근거 한 줄(보고서). */
  basis: string;
}

/**
 * 회수 판정(순수 함수 · H-T25): PID 조건 ∧ 메모리 조건.
 * - 증가분이 양수일 때만 메모리 조건(`used ≤ before − fraction × increase`)을 건다.
 * - 증가분이 0·미상이거나 STT가 CPU였으면(`cpuDevice`) GPU 메모리는 하락할 이유가 없으므로 PID 종료만 확인한다(H-1).
 * - 관찰 불가(nvidia-smi 실패)는 정책상 통과로 두되(보수적이지 않은 쪽으로 막지 않는다 — 시연 중단 방지) 근거 문구에 '확인 못함'을 명시한다(L-2).
 */
export function judgeReclaim(i: ReclaimInput): ReclaimJudgement {
  const fraction = i.fraction ?? 0.7;
  const pidsGone = i.appPids === null ? true : !i.watchedPids.some((p) => i.appPids!.includes(p));
  const pidNote = i.appPids === null ? ' · GPU 앱 목록 관찰 불가(확인 못함)' : '';
  let memoryOk: boolean;
  let basis: string;
  if (i.cpuDevice === true || i.increaseMiB === null || i.increaseMiB <= 0) {
    memoryOk = true;
    basis = `${i.cpuDevice === true ? 'CPU 구동이라 GPU 메모리 하락 조건 없음' : 'GPU 적재 증가분 없음·미상이라 메모리 하락 조건 없음'} · 프로세스 종료만 확인${pidNote}`;
  } else if (i.usedMiB === null || i.beforeMiB === null) {
    memoryOk = true; // 관찰 불가 — 통과로 두되 문구에 확인 못함을 밝힌다
    basis = `GPU 메모리 관찰 불가(확인 못함) · 프로세스 종료만 확인${pidNote}`;
  } else {
    memoryOk = i.usedMiB <= i.beforeMiB - fraction * i.increaseMiB;
    basis = `GPU 메모리 ${i.beforeMiB} -> ${i.usedMiB}MiB (증가분 ${i.increaseMiB}MiB의 ${Math.round(fraction * 100)}% 이상 하락)${pidNote}`;
  }
  return { ok: pidsGone && memoryOk, pidsGone, memoryOk, basis };
}

/** 회수가 확인될 때까지(또는 상한까지) 짧게 폴링한다. 실측 회수 ≤0.3초라 첫 표본에서 끝나는 것이 보통(DX-6). */
export async function waitForReclaim(o: {
  watchedPids: number[];
  beforeMiB: number | null;
  increaseMiB: number | null;
  cpuDevice?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ReclaimJudgement & { waitedMs: number; usedMiB: number | null }> {
  const t0 = Date.now();
  let last: ReclaimJudgement = { ok: false, pidsGone: false, memoryOk: false, basis: '' };
  let usedMiB: number | null = null;
  for (;;) {
    const mem = await queryGpuMemoryAsync();
    usedMiB = mem?.usedMiB ?? null;
    last = judgeReclaim({ watchedPids: o.watchedPids, appPids: await queryComputeAppPidsAsync(), usedMiB, beforeMiB: o.beforeMiB, increaseMiB: o.increaseMiB, cpuDevice: o.cpuDevice });
    if (last.ok || Date.now() - t0 >= o.timeoutMs || o.signal?.aborted) break;
    await sleepMs(250, o.signal);
  }
  return { ...last, waitedMs: Date.now() - t0, usedMiB };
}

export interface VramSample {
  at: number;
  event: string | null;
  usedMiB: number | null;
  totalMiB: number | null;
}

/** VRAM 관찰기(주기 2초 · 비동기 · 겹침 금지 — 설계 §11.4). 이벤트 이름을 붙인 표본을 쌓고 최근값·구간 최대를 낸다. */
export class VramObserver {
  readonly samples: VramSample[] = [];
  private running = false;
  private loop: Promise<void> | null = null;
  private readonly ac = new AbortController();

  constructor(private readonly intervalMs = 2000) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        await this.sampleNow(null);
        await sleepMs(this.intervalMs, this.ac.signal);
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.ac.abort();
    await this.loop?.catch(() => undefined);
  }

  /** 지금 한 번 조회해 이벤트 이름과 함께 기록한다. */
  mark(event: string): Promise<VramSample> {
    return this.sampleNow(event);
  }

  private async sampleNow(event: string | null): Promise<VramSample> {
    const m = await queryGpuMemoryAsync();
    const s: VramSample = { at: Date.now(), event, usedMiB: m?.usedMiB ?? null, totalMiB: m?.totalMiB ?? null };
    this.samples.push(s);
    if (this.samples.length > 2000) this.samples.splice(0, this.samples.length - 2000);
    return s;
  }

  latest(): GpuMemory | null {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.usedMiB !== null && s.totalMiB !== null) return { usedMiB: s.usedMiB, totalMiB: s.totalMiB };
    }
    return null;
  }

  /** 두 시각(에포크 ms) 사이의 최대 사용량(구간 최대 표). */
  maxBetween(fromMs: number, toMs: number): number | null {
    let max: number | null = null;
    for (const s of this.samples) if (s.at >= fromMs && s.at <= toMs && s.usedMiB !== null) max = max === null ? s.usedMiB : Math.max(max, s.usedMiB);
    return max;
  }

  /** 이벤트가 붙은 표본만. */
  events(): VramSample[] {
    return this.samples.filter((s) => s.event !== null);
  }
}
