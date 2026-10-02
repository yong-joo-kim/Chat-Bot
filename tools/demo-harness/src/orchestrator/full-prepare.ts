// [DT-2] 풀 투어 준비 단계(P4-L · P4-V · 게이트 G-DX-1~4 · 순차 적재 제어 · 정리) — 설계 §5 · §6 · §11.
// 10분판은 이 파일을 쓰지 않는다. 3050(4GB)에서는 STT(GPU)와 Ollama를 동시에 올리지 않는다:
//   P4-L 생성 자식 기동(워밍업이 모델 적재) → 사전 생성 → Ollama 해제 → P4-V 음성 기동 → 공연 ⑧⑨(STT 상주) → ⑩ SE-01에서 STT 종료·VRAM 회수 확인 → 모델 적재 → 생성 → 해제.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CliOptions } from '../cli/args';
import type { Ports, RepoPaths } from '../config';
import { ApiSession } from '../data/api-client';
import { putSemantic, simulate, type GateResult } from '../data/calibration';
import { PREPARED_GENERATION, VOICE_PHRASE, voiceSettingsA } from '../data/dataset-full';
import { INTENTS_A } from '../data/dataset';
import type { DatasetIds } from '../data/types';
import { buildAugmentEnv, OLLAMA_MODEL } from '../env/ml-augment-env';
import { buildSpeechEnv } from '../env/ml-speech-env';
import { listProcessTree } from '../proc/system';
import { VramObserver, queryGpuMemoryAsync, waitForReclaim } from '../gpu/nvidia-smi';
import { OllamaClient, OLLAMA_DEFAULT_URL } from '../llm/ollama-client';
import { ProcessDiedError, waitHealthy } from '../proc/health';
import { Supervisor } from '../proc/supervisor';
import type { OverrideRow } from '../env/api-env';
import { STT_MODEL_ROOT, type FullPreflightResult, type LlmPreflight, type VoicePreflight } from '../preflight/full-checks';
import type { RunPaths } from '../run/run-dir';
import type { FullRecord, FullStepEnv, GenerationRecord, GpuControl, GpuLoadResult, GpuStopResult, PreparedGeneration, VoiceRunInfo } from '../scenario/full-env';
import { defaultPlan, demonstratedFeatureNos, egressNames, gpuUse, GPU_USE_TEXT, omittedCustomerLines, resolvePreset, serverNames, SCENE_TITLES, type DeviceNote, type PlanContext, type ResolvedPreset, type SttDevice, type SttModel } from '../scenario/plan';
import type { PresetDef } from '../scenario/types';
import type { StageFacts, StageGpuFacts, StagePlanFacts } from '../stage/facts';
import { judgeTranscript } from '../voice/match';
import { sleepMs, waitFor, WaitAbortedError } from '../util/wait-for';
import { PrepareError } from './errors';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function emptyRecord(): FullRecord {
  return { speech: null, prepared: null, live: null, loadMs: null, unloaded: null, downloads: [], proactive: null, vram: [], honesty: [], badgeNotes: [], voiceStatsBaseline: null, micOpened: 0 };
}

export function idleGpuFacts(): StageGpuFacts {
  return { sttState: 'NONE', beforeStopMiB: null, afterStopMiB: null, usedMiB: null, totalMiB: null, loadSec: null, model: null, ollamaActive: false, phase: 'idle', failedStep: null };
}

// ═══ 계획 확정(사전 점검 결과 → 계획 문맥) ═══
export interface PlanBlock {
  what: string;
  why: string;
  how: string;
}

export interface PlanFromPreflight {
  plan: PlanContext;
  /** 보이는 시연에서 경고 + 생략으로 처리된 항목(진행자 확인 대상). */
  omitted: string[];
  /** 차단(종료 2) 항목. */
  blocks: PlanBlock[];
}

type PlanOpts = Pick<CliOptions, 'withVoiceInput' | 'voiceMockCheck' | 'sttDevice' | 'sttDeviceExplicit' | 'withLocalLlm' | 'liveClustering' | 'mode'>;

/** 풀 투어 초기 계획 — 플래그만 반영(장치·불가 판정은 사전 점검 뒤 `planFromPreflight`가 확정). */
export function initialPlan(presetId: string, opts: PlanOpts): PlanContext {
  const base = defaultPlan(presetId, opts.mode);
  return {
    ...base,
    full: true,
    voiceInput: opts.voiceMockCheck ? 'mock' : opts.withVoiceInput ? 'real' : 'off',
    sttRequested: opts.sttDevice,
    localLlm: opts.withLocalLlm,
    liveClustering: opts.liveClustering,
    voiceRequested: opts.withVoiceInput || opts.voiceMockCheck,
    llmRequested: opts.withLocalLlm,
  };
}

/**
 * 사전 점검 사실 → 최종 계획(설계 §5.1 · §5.2 · A-DX-2). 순수 함수(H-T22).
 * 불가 판정의 처리: 보이는 시연 = 경고 + 해당 장면 생략(음성 → voiceInput=off · 생성 → localLlm=false) · 무인 점검 = 차단 · 장치 명시 불가 = 양쪽 차단.
 */
export function planFromPreflight(base: PlanContext, opts: PlanOpts, voice: VoicePreflight, llm: LlmPreflight): PlanFromPreflight {
  const plan: PlanContext = { ...base };
  const omitted: string[] = [];
  const blocks: PlanBlock[] = [];
  const headless = opts.mode === 'headless-check';
  const MOCK_HINT = 'STT 모델이 없는 PC에서는 --voice-mock-check로 위젯 -> API 구간만 점검할 수 있습니다(음성 인식은 점검하지 않습니다)';

  if (voice.requested) {
    if (voice.mock) {
      if (voice.mockUnavailable) blocks.push({ what: '음성 입력 모의 점검을 할 수 없습니다', why: voice.mockUnavailable, how: '합성 음성·가짜 마이크가 필요합니다. 점검 항목(PC-DX-6·7)을 확인하세요' });
      else plan.voiceInput = 'mock';
    } else if (voice.decision) {
      const d = voice.decision;
      if (d.kind === 'BLOCK') {
        blocks.push({ what: `--stt-device ${opts.sttDevice}를 쓸 수 없습니다`, why: d.reason, how: '--stt-device auto 또는 cpu로 바꾸세요' });
      } else if (d.kind === 'UNAVAILABLE') {
        if (headless) blocks.push({ what: `음성 입력 장면을 준비하지 못했습니다 (${d.reason})`, why: '무인 점검에서는 음성 인식이 없는 채로 진행하지 않습니다', how: `${MOCK_HINT} · 또는 --with-voice-input 없이 실행하세요` });
        else {
          plan.voiceInput = 'off';
          plan.voiceOmittedReason = d.reason;
          omitted.push(`음성 입력 장면을 생략합니다 (${d.reason})`);
        }
      } else {
        plan.voiceInput = 'real';
        plan.sttDevice = d.device;
        plan.sttModel = d.model;
        plan.deviceNote = d.note;
      }
    }
  }
  if (llm.requested && llm.unavailableReason) {
    if (headless) blocks.push({ what: `사내 생성 모델 장면(장면 10)을 준비하지 못했습니다 (${llm.unavailableReason})`, why: '무인 점검에서는 생성 모델이 없는 채로 진행하지 않습니다', how: 'Ollama를 실행하고 ollama list로 모델을 확인한 뒤 다시 실행하세요' });
    else {
      plan.localLlm = false;
      plan.llmOmittedReason = llm.unavailableReason;
      omitted.push(`사내 생성 모델 장면(장면 10)을 생략합니다 (${llm.unavailableReason})`);
    }
  }
  return { plan, omitted, blocks };
}

// ═══ 실행 상태 ═══
export interface FullRuntime {
  preset: PresetDef;
  opts: CliOptions;
  plan: PlanContext;
  resolved: ResolvedPreset;
  record: FullRecord;
  gpuActive: string[];
  gpuFacts: StageGpuFacts;
  observer: VramObserver | null;
  ollama: OllamaClient | null;
  ollamaLoadedByHarness: boolean;
  /** STT 적재로 늘어난 VRAM(MiB) — 회수 판정의 증분. */
  sttIncreaseMiB: number | null;
  voice: VoiceRunInfo | null;
  prepared: PreparedGeneration | null;
  pre: FullPreflightResult | null;
  wavPath: string | null;
  /** 모델 구성표(실제 올라간 값). */
  models: Array<{ role: 'embed' | 'speech' | 'augment'; port: number; backend: string; modelId: string; device: string; computeType?: string; fallbackFrom?: string | null; profile?: string; targetCap?: number; note?: string }>;
  /** 자식 환경 공개표 행(보고서 공개표에 합친다). */
  childOverrides: OverrideRow[];
  /** 음성 인식 자식 기동 결과 한 줄(보고서). */
  speechNote: string | null;
  /** 사전 점검에서 모은 경고·생략 알림(요약에 다시 보인다). */
  omitted: string[];
  koreanVoices: number | null;
  gates: GateResult[];
  /** G-DX-3가 확인한 챗봇 D 공개 선제 규칙(문구·버튼·머문 시간). */
  proactiveRule: { dwellSec: number; text: string; buttons: string[] } | null;
}

export function createFullRuntime(opts: CliOptions, preset: PresetDef): FullRuntime {
  const plan = initialPlan(preset.id, opts);
  return {
    preset,
    opts,
    plan,
    resolved: resolvePreset(preset, plan),
    record: emptyRecord(),
    gpuActive: [],
    gpuFacts: idleGpuFacts(),
    observer: null,
    ollama: null,
    ollamaLoadedByHarness: false,
    sttIncreaseMiB: null,
    voice: null,
    prepared: null,
    pre: null,
    wavPath: null,
    models: [],
    childOverrides: [],
    speechNote: null,
    omitted: [],
    koreanVoices: null,
    gates: [],
    proactiveRule: null,
  };
}

/** 계획이 바뀐 뒤 해석을 다시 한다(구간·예산·비활성 행). */
export function refreshResolved(rt: FullRuntime): void {
  rt.resolved = resolvePreset(rt.preset, rt.plan);
}

// ═══ 자식 프로세스(음성 · 생성) ═══
interface ChildDeps {
  supervisor: Supervisor;
  run: RunPaths;
  paths: RepoPaths;
  ports: Ports;
  parentEnv: NodeJS.ProcessEnv;
  redact: (s: string) => string;
  signal: AbortSignal;
  log: (m: string) => void;
}

function tailReason(lines: readonly string[]): string {
  const err = lines.find((l) => /\b\w*Error\b|오류|실패|not found|cannot/i.test(l) && l.trim().length > 0);
  const pick = err ?? [...lines].reverse().find((l) => l.trim().length > 0) ?? '';
  return pick.trim().slice(0, 160);
}

async function startSpeechChild(d: ChildDeps, model: SttModel, device: SttDevice): Promise<OverrideRow[]> {
  const env = buildSpeechEnv({ parentEnv: d.parentEnv, ports: d.ports, modelRoot: STT_MODEL_ROOT(d.paths), model, device, sitePackages: join(d.paths.mlWorkerDir, '.venv', 'Lib', 'site-packages') });
  const cwd = join(d.run.dir, 'ml-speech');
  mkdirSync(cwd, { recursive: true });
  await d.supervisor.startChild({
    name: 'ml-speech',
    command: d.paths.venvPython,
    args: ['-X', `cbdemo_run=${d.run.runId}`, '-m', 'ml_worker.app'],
    cwd,
    env: env.env,
    logFile: join(d.run.logs, 'ml-speech.log'),
    marker: `cbdemo_run=${d.run.runId}`,
    redact: d.redact,
  });
  return env.overrides;
}

interface SpeechHealth {
  status?: string;
  backend?: string;
  modelId?: string;
  device?: string;
  computeType?: string;
  vad?: string;
  warmedUp?: boolean;
}

/** `/speech/health`가 ok·warmedUp·faster-whisper가 될 때까지(상한 60초). 자식이 죽으면 즉시 실패. */
async function waitSpeechReady(d: ChildDeps): Promise<SpeechHealth> {
  const proc = d.supervisor.find('ml-speech')!;
  const res = await waitHealthy({
    url: `http://127.0.0.1:${d.ports.mlSpeech}/speech/health`,
    label: '음성 인식 서버',
    timeoutMs: 60_000,
    hasExited: () => proc.exited,
    accept: (r) => {
      const b = r.body as SpeechHealth | null;
      return r.ok && b?.status === 'ok' && b?.warmedUp === true && b?.backend === 'faster-whisper';
    },
    signal: d.signal,
  });
  return res.body as SpeechHealth;
}

export interface SpeechBringUp {
  ok: boolean;
  device: SttDevice | null;
  model: SttModel | null;
  note: DeviceNote | null;
  health: SpeechHealth | null;
  reason?: string;
}

/**
 * P4-V: 음성 인식 자식 기동. `auto`이고 cuda로 정했는데 기동에 실패하면(자식 종료 · 상한 초과 · health의 device ≠ cuda) 트리를 종료하고 small·cpu로 1회 재기동한다(공개 — DEVICE_FALLBACK).
 * 사전 점검(DLL 폴더 유무)은 힌트이고 이 기동 시도가 최종 판정이다(DX-8).
 */
export async function bringUpSpeech(rt: FullRuntime, d: ChildDeps): Promise<SpeechBringUp> {
  const plan = rt.plan;
  const device = plan.sttDevice as SttDevice;
  const model = plan.sttModel as SttModel;
  const memBefore = await queryGpuMemoryAsync();
  const attempt = async (m: SttModel, dev: SttDevice): Promise<{ ok: boolean; health?: SpeechHealth; reason?: string }> => {
    try {
      rt.childOverrides.push(...(await startSpeechChild(d, m, dev)));
      const health = await waitSpeechReady(d);
      if (dev === 'cuda' && health.device !== 'cuda') return { ok: false, reason: `기동은 했지만 장치가 ${health.device ?? '?'}입니다(cuda 아님)` };
      return { ok: true, health };
    } catch (e) {
      if (e instanceof WaitAbortedError || d.signal.aborted) throw e; // 중단은 삼키지 않는다(M-3) — small·cpu 재기동 방지
      const proc = d.supervisor.find('ml-speech');
      const tail = proc ? tailReason(proc.tail(200)) : '';
      return { ok: false, reason: tail || (e instanceof ProcessDiedError ? '자식 프로세스가 기동 중에 종료했습니다' : (e as Error).message) };
    }
  };
  let r = await attempt(model, device);
  if (r.ok) {
    const memAfter = await queryGpuMemoryAsync();
    rt.sttIncreaseMiB = device === 'cuda' && memBefore && memAfter ? Math.max(0, memAfter.usedMiB - memBefore.usedMiB) : null;
    return { ok: true, device, model, note: plan.deviceNote ?? null, health: r.health ?? null };
  }
  await d.supervisor.stopChild('ml-speech');
  if (device === 'cuda' && plan.sttRequested === 'auto' && rt.pre?.voice.facts?.smallCache) {
    d.log(`음성 인식 GPU 시작 실패 -> small·cpu로 다시 시작합니다: ${r.reason ?? ''}`);
    r = await attempt('small', 'cpu');
    if (r.ok) return { ok: true, device: 'cpu', model: 'small', note: { kind: 'FALLBACK', reason: r.reason ?? 'GPU 시작 실패' }, health: r.health ?? null };
    await d.supervisor.stopChild('ml-speech');
  }
  return { ok: false, device: null, model: null, note: null, health: null, reason: r.reason ?? '음성 인식 서버를 시작하지 못했습니다' };
}

/** G-DX-1: 합성 WAV를 API 직접 호출로 인식시켜 기대 문장과 비교(브라우저 없음 — 가짜 마이크 파일을 소비하지 않는다). */
export async function gateDx1(a: { apiBase: string; slug: string; origin: string; wavPath: string; expected: string; keywords: readonly string[] }): Promise<{ ok: boolean; transcript: string | null; ratio: number | null; detail: string }> {
  try {
    const wav = readFileSync(a.wavPath);
    const res = await fetch(`${a.apiBase}/public/chatbots/${a.slug}/speech/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', origin: a.origin, 'x-cb-session-id': randomUUID() },
      body: wav,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; empty?: boolean };
    if (!res.ok) return { ok: false, transcript: null, ratio: null, detail: `HTTP ${res.status}` };
    const text = body.text ?? '';
    const j = judgeTranscript(a.expected, text, a.keywords);
    return { ok: j.textOk && !body.empty, transcript: text, ratio: Math.round(j.ratio * 100) / 100, detail: `전사 "${text}" · 일치율 ${j.ratio.toFixed(2)} · 핵심어 ${j.keywordsOk ? '포함' : '없음'}` };
  } catch (e) {
    return { ok: false, transcript: null, ratio: null, detail: (e as Error).message };
  }
}

/** G-DX-2: 그 글자가 기대 의도(환불문의)로 답하는지 — 의미 매칭을 잠시 켜고 시뮬레이터로 확정(G-1과 같은 켜고 끄기 · 감사 로그 2행). */
export async function gateDx2(api: ApiSession, botId: string, text: string): Promise<{ ok: boolean; detail: string }> {
  let on = false;
  try {
    await putSemantic(api, botId, true);
    on = true;
    const r = await simulate(api, botId, text);
    const want = `${VOICE_PHRASE.intentName} 응답`;
    return { ok: r.node === want, detail: `시뮬레이터 1위 노드 ${r.node ?? '(없음)'} (기대 ${want})` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  } finally {
    if (on) await putSemantic(api, botId, false).catch(() => undefined);
  }
}

/** G-DX-3: 챗봇 D 공개 설정에 선제 규칙 1개(버튼 2 · 머문 시간 5초)가 실려 나오는지. */
export async function gateDx3(a: { apiBase: string; slug: string; origin: string }): Promise<{ ok: boolean; detail: string; rule: { dwellSec: number; text: string; buttons: string[] } | null }> {
  try {
    const res = await fetch(`${a.apiBase}/public/chatbots/${a.slug}/config?proactive=1`, { headers: { origin: a.origin }, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { proactive?: { rules?: Array<{ trigger?: { dwellSec?: number }; text?: string; buttons?: Array<{ label: string }> }> } };
    const rules = body.proactive?.rules ?? [];
    const r = rules[0];
    const ok = res.ok && rules.length === 1 && (r?.buttons?.length ?? 0) === 2 && r?.trigger?.dwellSec === 5;
    return { ok, detail: `규칙 ${rules.length}개 · 버튼 ${r?.buttons?.length ?? 0} · 머문 시간 ${r?.trigger?.dwellSec ?? '?'}초`, rule: r ? { dwellSec: r.trigger?.dwellSec ?? 0, text: r.text ?? '', buttons: (r.buttons ?? []).map((b) => b.label) } : null };
  } catch (e) {
    return { ok: false, detail: (e as Error).message, rule: null };
  }
}

// ═══ P4-L: 생성 자식 · 사전 생성 · 해제 ═══
export interface LlmPrepareResult {
  ok: boolean;
  reason?: string;
  gate: GateResult;
}

export async function prepareLlm(rt: FullRuntime, d: ChildDeps & { admin1: ApiSession; ids: DatasetIds }): Promise<LlmPrepareResult> {
  const client = rt.ollama ?? (rt.ollama = new OllamaClient(OLLAMA_DEFAULT_URL));
  const env = buildAugmentEnv({ parentEnv: d.parentEnv, ports: d.ports });
  rt.childOverrides.push(...env.overrides);
  const fail = (reason: string): LlmPrepareResult => ({ ok: false, reason, gate: { id: 'G-DX-4', scene: '장면 10', ok: false, detail: reason } });
  const cwd = join(d.run.dir, 'ml-augment');
  mkdirSync(cwd, { recursive: true });
  try {
    await d.supervisor.startChild({
      name: 'ml-augment',
      command: d.paths.venvPython,
      args: ['-X', `cbdemo_run=${d.run.runId}`, '-m', 'ml_worker.app'],
      cwd,
      env: env.env,
      logFile: join(d.run.logs, 'ml-augment.log'),
      marker: `cbdemo_run=${d.run.runId}`,
      redact: d.redact,
    });
    rt.ollamaLoadedByHarness = true; // 워밍업 요청이 모델을 올린다 — 해제 책임은 하네스에 있다
    const proc = d.supervisor.find('ml-augment')!;
    const health = await waitHealthy({
      url: `http://127.0.0.1:${d.ports.mlAugment}/augment/health`,
      label: '사내 생성 서버',
      timeoutMs: 150_000,
      hasExited: () => proc.exited,
      accept: (r) => r.ok && (r.body as { status?: string } | null)?.status === 'ok',
      signal: d.signal,
    });
    const hb = health.body as Json;
    rt.models.push({ role: 'augment', port: d.ports.mlAugment as number, backend: String(hb.backend ?? 'ollama'), modelId: `ollama:${OLLAMA_MODEL}`, device: String(hb.device ?? 'external'), profile: String(hb.profile ?? 'lightweight'), targetCap: Number(hb.targetCap ?? 20) });
    await rt.observer?.mark('P4-L 워밍업 후');
    // 사전 생성 1회(회원정보 · 목표 20건 · 상한 60초) — 대체 화면용 결과
    const intentKey = PREPARED_GENERATION.intentKey;
    const intent = INTENTS_A.find((i) => i.key === intentKey)!;
    const intentId = d.ids.A.intents[intentKey].intentId;
    const t0 = Date.now();
    await d.admin1.post(`/chatbots/${d.ids.A.id}/intents/${intentId}/augmentations`, { count: PREPARED_GENERATION.count });
    const list = await waitFor(
      async () => {
        const r = (await d.admin1.get(`/chatbots/${d.ids.A.id}/intents/${intentId}/augmentations`, { query: { status: 'PENDING', pageSize: 50 } })).body as Json;
        return r.runResult ? r : false;
      },
      { timeoutMs: 60_000, intervalMs: 1000, label: '사전 생성 완료', signal: d.signal },
    );
    const rr = list.runResult as Json;
    const record: GenerationRecord = {
      providerId: String(rr.providerId ?? '?'),
      degraded: rr.degraded === true,
      fallbackFrom: (rr.fallbackFrom as string | undefined) ?? null,
      candidates: ((list.items ?? []) as unknown[]).length,
      elapsedMs: Date.now() - t0,
      source: 'PREPARED',
      intentName: intent.name,
    };
    await rt.observer?.mark('사전 생성 후');
    rt.record.prepared = record;
    const genOk = record.providerId === 'local' && !record.degraded && record.candidates >= 1;
    const gate: GateResult = { id: 'G-DX-4', scene: '장면 10', ok: genOk, detail: `사전 생성 ${record.providerId}${record.degraded ? '(폴백)' : ''} · 후보 ${record.candidates}개 · ${(record.elapsedMs / 1000).toFixed(1)}초` };
    // 해제(필수 — ml-worker는 keep_alive를 보내지 않아 Ollama 기본 보존 시간 동안 VRAM에 남는다) + 회수 확인
    const un = await client.unload(OLLAMA_MODEL);
    const gone = un.ok && (await client.waitLoaded(OLLAMA_MODEL, false, 20_000, (ms) => sleepMs(ms, d.signal)));
    rt.ollamaLoadedByHarness = !gone;
    await rt.observer?.mark('해제 후');
    if (!gone) return { ok: false, reason: `사전 생성 뒤 모델을 내리지 못했습니다: ${un.error ?? '/api/ps에 남아 있음'}`, gate: { ...gate, ok: false, detail: `${gate.detail} · 해제 실패` } };
    rt.record.unloaded = true;
    if (!genOk) return { ok: false, reason: '사전 생성이 로컬 후보를 만들지 못했습니다(폴백 또는 0건)', gate };
    rt.prepared = { intentId, intentName: intent.name, record };
    return { ok: true, gate };
  } catch (e) {
    if (e instanceof WaitAbortedError || d.signal.aborted) throw e; // 중단은 삼키지 않는다(M-3)
    const proc = d.supervisor.find('ml-augment');
    return fail(`${tailReason(proc?.tail(200) ?? []) || (e as Error).message}`);
  }
}

// ═══ ⑩ 순차 적재 제어(GpuControl) ═══
export function makeGpuControl(rt: FullRuntime, d: { supervisor: Supervisor; stageFacts: StageFacts; signal: AbortSignal; log: (m: string) => void }): GpuControl {
  const g = rt.gpuFacts;
  const client = (): OllamaClient => rt.ollama ?? (rt.ollama = new OllamaClient(OLLAMA_DEFAULT_URL));
  return {
    async stopSpeech(): Promise<GpuStopResult> {
      const p = d.supervisor.find('ml-speech');
      g.model = OLLAMA_MODEL;
      if (!p || p.exited) {
        g.sttState = 'NONE';
        g.phase = 'loading';
        return { ok: true, beforeMiB: null, afterMiB: null, waitedMs: 0 };
      }
      g.phase = 'stopping';
      g.sttState = 'RUNNING';
      const before = await queryGpuMemoryAsync();
      g.beforeStopMiB = before?.usedMiB ?? null;
      g.usedMiB = before?.usedMiB ?? null;
      g.totalMiB = before?.totalMiB ?? null;
      const tree = p.pid ? listProcessTree(p.pid) : [];
      await d.supervisor.stopChild('ml-speech');
      rt.gpuActive.splice(0, rt.gpuActive.length, ...rt.gpuActive.filter((x) => !x.startsWith('음성 인식')));
      const r = await waitForReclaim({ watchedPids: tree, beforeMiB: before?.usedMiB ?? null, increaseMiB: rt.sttIncreaseMiB, cpuDevice: rt.plan.sttDevice === 'cpu', timeoutMs: 15_000, signal: d.signal });
      g.afterStopMiB = r.usedMiB;
      g.usedMiB = r.usedMiB;
      g.sttState = 'STOPPED';
      await rt.observer?.mark('STT 종료 후');
      if (!r.ok) {
        g.phase = 'failed';
        g.failedStep = 1;
        return { ok: false, beforeMiB: before?.usedMiB ?? null, afterMiB: r.usedMiB, waitedMs: r.waitedMs, reason: r.basis };
      }
      g.phase = 'loading';
      d.log(`음성 인식을 내렸습니다: ${r.basis} (${(r.waitedMs / 1000).toFixed(1)}초 · 관찰값)`);
      return { ok: true, beforeMiB: before?.usedMiB ?? null, afterMiB: r.usedMiB, waitedMs: r.waitedMs };
    },
    async loadOllama(): Promise<GpuLoadResult> {
      g.phase = 'loading';
      const t0 = Date.now();
      const r = await client().load(OLLAMA_MODEL, 60_000);
      rt.ollamaLoadedByHarness = true;
      if (!r.ok) {
        g.phase = 'failed';
        g.failedStep = 2;
        return { ok: false, loadMs: Date.now() - t0, reason: r.error };
      }
      g.phase = 'verifying';
      const seen = await client().waitLoaded(OLLAMA_MODEL, true, 10_000, (ms) => sleepMs(ms, d.signal));
      g.loadSec = Math.round((Date.now() - t0) / 100) / 10;
      rt.record.loadMs = Date.now() - t0;
      const mem = await queryGpuMemoryAsync();
      g.usedMiB = mem?.usedMiB ?? g.usedMiB;
      g.totalMiB = mem?.totalMiB ?? g.totalMiB;
      await rt.observer?.mark('Ollama 적재 후');
      if (!seen) {
        g.phase = 'failed';
        g.failedStep = 3;
        return { ok: false, loadMs: Date.now() - t0, reason: '/api/ps에서 모델을 확인하지 못했습니다' };
      }
      g.ollamaActive = true;
      g.phase = 'done';
      if (!rt.gpuActive.includes('사내 생성 모델')) rt.gpuActive.push('사내 생성 모델');
      return { ok: true, loadMs: Date.now() - t0 };
    },
    async unloadOllama(): Promise<{ ok: boolean; reason?: string }> {
      const un = await client().unload(OLLAMA_MODEL);
      const gone = un.ok && (await client().waitLoaded(OLLAMA_MODEL, false, 20_000, (ms) => sleepMs(ms, d.signal)));
      if (gone) {
        rt.ollamaLoadedByHarness = false;
        rt.record.unloaded = true;
        g.ollamaActive = false;
        rt.gpuActive.splice(0, rt.gpuActive.length, ...rt.gpuActive.filter((x) => x !== '사내 생성 모델'));
        await d.supervisor.stopChild('ml-augment');
      }
      await rt.observer?.mark('해제 후(장면 10)');
      const mem = await queryGpuMemoryAsync();
      g.usedMiB = mem?.usedMiB ?? g.usedMiB;
      return gone ? { ok: true } : { ok: false, reason: un.error ?? '/api/ps에 남아 있음' };
    },
    snapshot() {
      const l = rt.observer?.latest();
      return { usedMiB: l?.usedMiB ?? null, totalMiB: l?.totalMiB ?? null };
    },
    mark(event: string) {
      void rt.observer?.mark(event);
    },
  };
}

/** 정리 단계: 하네스가 적재한 Ollama 모델 해제(실패해도 경고만 · Ollama 서비스는 종료하지 않는다) + VRAM 관찰기 종료. */
export async function fullCleanup(rt: FullRuntime, log: (m: string) => void): Promise<{ unloadWarning: string | null }> {
  let warn: string | null = null;
  if (rt.ollamaLoadedByHarness && rt.ollama) {
    const un = await rt.ollama.unload(OLLAMA_MODEL);
    const gone = un.ok && (await rt.ollama.waitLoaded(OLLAMA_MODEL, false, 20_000, (ms) => sleepMs(ms)));
    if (gone) {
      rt.ollamaLoadedByHarness = false;
      rt.record.unloaded = true;
    } else warn = `생성 모델을 내리지 못했습니다(${un.error ?? '/api/ps에 남아 있음'}) — 수동으로: ollama stop ${OLLAMA_MODEL}`;
  }
  await rt.observer?.stop();
  if (warn) log(warn);
  return { unloadWarning: warn };
}

// ═══ 공연 입력 · 무대 사실 ═══
/** 음성 시연 정보(합성 음성 + 게이트 결과). */
export function makeVoiceInfo(rt: FullRuntime): VoiceRunInfo | null {
  const w = rt.pre?.voice.wav;
  if (rt.plan.voiceInput === 'off' || !w?.ok || !rt.wavPath) return null;
  return {
    mode: rt.plan.voiceInput === 'mock' ? 'mock' : 'real',
    wavPath: rt.wavPath,
    wavSec: w.wav?.durationSec ?? 0,
    wavBytes: w.bytes,
    expected: VOICE_PHRASE.expected,
    keywords: [...VOICE_PHRASE.keywords],
    gateTranscript: rt.record.speech?.gateTranscript ?? null,
    gateRatio: rt.record.speech?.gateRatio ?? null,
    audioUrl: '/audio/utterance.wav',
    device: rt.plan.sttDevice,
    modelLabel: rt.plan.sttModel,
  };
}

/** 풀 투어 단계 환경(StepContext.full). */
export function makeStepEnv(rt: FullRuntime, a: { gpu: GpuControl; stageFacts: StageFacts; downloadsDir: string; speakerEnabled: boolean; proactive: FullStepEnv['proactive']; soundNote: (t: string) => void }): FullStepEnv {
  return { voice: rt.voice, gpu: a.gpu, record: rt.record, stageFacts: a.stageFacts, prepared: rt.prepared, downloadsDir: a.downloadsDir, speakerEnabled: a.speakerEnabled, proactive: a.proactive, koreanVoices: rt.koreanVoices, soundNote: a.soundNote };
}

/** `/__facts.plan` — 시작·마무리 카드와 로드맵이 읽는 계획 요약. */
export function buildStagePlan(rt: FullRuntime): StagePlanFacts {
  const p = rt.plan;
  const r = rt.resolved;
  const voiceState: StagePlanFacts['voice']['state'] = p.voiceInput === 'real' || p.voiceInput === 'mock' ? 'SHOWN' : p.voiceRequested ? 'UNAVAILABLE' : 'NOT_REQUESTED';
  const llmState: StagePlanFacts['llm']['state'] = p.localLlm ? 'SHOWN' : p.llmRequested ? 'UNAVAILABLE' : 'NOT_REQUESTED';
  const use = gpuUse(p);
  const omittedLines = omittedCustomerLines(
    r.inactiveRows.filter((x) => !x.reason.hidden),
    r.inactiveSegments.filter((x) => !x.reason.hidden),
  );
  return {
    sceneCount: r.sceneCount,
    totalSec: r.totalBudgetSec,
    servers: serverNames(p),
    voice: { state: voiceState, modelLabel: p.sttModel, device: p.voiceInput === 'real' ? (p.sttDevice === 'cuda' ? 'GPU' : 'CPU') : null, note: p.deviceNote?.kind ?? null, noteReason: p.deviceNote?.reason ?? null },
    llm: { state: llmState, modelLabel: p.localLlm ? 'qwen3 4B q4 · Ollama' : null },
    liveClustering: p.liveClustering,
    gpuUse: use,
    gpuUseText: GPU_USE_TEXT[use],
    egressNames: egressNames(p),
    augmentation: p.localLlm ? 'local' : 'rule',
    omittedLines,
    sceneTitles: r.segments.filter((s) => s.key !== 'opening' && s.key !== 'closing').map((s) => SCENE_TITLES[s.key] ?? s.title),
    demonstratedNos: demonstratedFeatureNos(r.segments),
  };
}

export function applyVoiceSettings(api: ApiSession, botId: string, refundNodeId: string, inputEnabled: boolean): Promise<unknown> {
  return api.put(`/chatbots/${botId}/voice`, voiceSettingsA(inputEnabled, refundNodeId));
}

export { PrepareError };
