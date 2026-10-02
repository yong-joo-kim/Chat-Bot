// [DT-2] P4-L · P4-V — 모델 준비(생성 자식 · 음성 자식 · 게이트 G-DX-1·2·4) — 설계 §5.
// 불가·게이트 실패의 처리: 보이는 시연 = 해당 장면 비활성 + 이유(경고) · 무인 점검 = 차단(종료 2).
// 순서가 3050 순차 적재 원칙이다: 생성(모델 적재) → 사전 생성 → **해제** → 음성 기동.
import type { CliOptions } from '../cli/args';
import type { Ports, RepoPaths } from '../config';
import type { GateResult } from '../data/calibration';
import { VOICE_PHRASE } from '../data/dataset-full';
import { queryGpuMemoryAsync, VramObserver } from '../gpu/nvidia-smi';
import type { Terminal } from '../log/terminal';
import type { Supervisor } from '../proc/supervisor';
import type { RunPaths } from '../run/run-dir';
import type { Redactor } from '../util/redact';
import type { DataPhaseResult } from './data-phase';
import { AbortedError, PrepareError } from './errors';
import { applyVoiceSettings, bringUpSpeech, gateDx1, gateDx2, makeVoiceInfo, prepareLlm, refreshResolved, type FullRuntime } from './full-prepare';

export interface ModelPrepareInput {
  rt: FullRuntime;
  term: Terminal;
  paths: RepoPaths;
  run: RunPaths;
  ports: Ports;
  supervisor: Supervisor;
  parentEnv: NodeJS.ProcessEnv;
  redactor: Redactor;
  data: DataPhaseResult;
  signal: AbortSignal;
  opts: CliOptions;
  /** 임베딩 자식이 알려 준 모델·장치(모델 구성표). */
  embed: { modelId: string; device: string; port: number };
}

const MOCK_HINT = 'STT 모델이 없는 PC에서는 --voice-mock-check로 위젯 -> API 구간만 점검할 수 있습니다(음성 인식은 점검하지 않습니다)';

function gateLine(term: Terminal, g: GateResult, severe: boolean): void {
  if (g.ok) term.line('pass', `보정 ${g.id}(${g.scene}): ${g.detail}`);
  else term.line(severe ? 'error' : 'warn', `보정 ${g.id}(${g.scene}): ${g.detail}`);
}

/** 단계 사이 중단 확인(M-3) — Ctrl+C 뒤에 다음 단계(기동·게이트)를 시작하지 않는다. */
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortedError();
}

export async function runModelPrepare(a: ModelPrepareInput): Promise<void> {
  const { rt, term, opts } = a;
  const headless = opts.mode === 'headless-check';
  const wantGpuObserve = (rt.plan.voiceInput === 'real' && rt.plan.sttDevice === 'cuda') || rt.plan.localLlm;
  rt.models.push({ role: 'embed', port: a.embed.port, backend: 'sentence-transformers', modelId: a.embed.modelId, device: a.embed.device });
  if (wantGpuObserve) {
    rt.observer = new VramObserver();
    rt.observer.start();
    await rt.observer.mark('P0');
  }
  const m0 = await queryGpuMemoryAsync();
  rt.gpuFacts.usedMiB = m0?.usedMiB ?? null;
  rt.gpuFacts.totalMiB = m0?.totalMiB ?? null;
  const childDeps = { supervisor: a.supervisor, run: a.run, paths: a.paths, ports: a.ports, parentEnv: a.parentEnv, redact: (s: string) => a.redactor.redact(s), signal: a.signal, log: (msg: string) => term.detail(msg) };
  const admin1 = a.data.data.sessions.admin1;
  const ids = a.data.data.ids;
  const refundNodeId = ids.A.intents.refund.nodeId;

  // ── P4-L ──
  checkAbort(a.signal);
  if (rt.plan.localLlm) {
    term.line('progress', '사내 생성 모델 준비: 생성 서버 기동(모델 적재) -> 사전 생성 -> 모델 내림 (상한 약 03:30)');
    const r = await prepareLlm(rt, { ...childDeps, admin1, ids });
    rt.gates.push(r.gate);
    gateLine(term, r.gate, headless);
    if (!r.ok) {
      if (headless) throw new PrepareError(`사내 생성 모델 준비 실패: ${r.reason ?? ''}`, '무인 점검에서는 생성 모델이 없는 채로 진행하지 않습니다', '로그 ml-augment.log를 확인하고 Ollama·모델 상태를 점검한 뒤 다시 실행하세요(데이터 보정 필요 — G-DX-4)');
      term.line('warn', `사내 생성 모델 장면(장면 10)을 생략합니다 (${r.reason ?? '사전 생성 실패'})`, { why: '사전 생성 게이트(G-DX-4)를 통과하지 못했습니다', how: '대체 화면이 없으므로 장면 전체를 생략하고 이유를 로드맵에 표시합니다' });
      rt.plan = { ...rt.plan, localLlm: false, llmOmittedReason: r.reason ?? '사전 생성 실패' };
      rt.omitted.push(`사내 생성 모델 장면(장면 10)을 생략합니다 (${r.reason ?? ''})`);
      await a.supervisor.stopChild('ml-augment');
      refreshResolved(rt);
    } else {
      term.line('pass', `사내 생성 모델 준비: 사전 생성 ${rt.prepared?.record.candidates ?? 0}건(${rt.prepared?.intentName}) · 모델 내림 확인`);
    }
  }

  // ── P4-V ──
  checkAbort(a.signal);
  if (rt.plan.voiceInput === 'real') {
    term.line('progress', `음성 인식 준비: 장치 결정 -> 기동 -> 합성 음성 확인 (${rt.plan.sttDevice === 'cuda' ? 'GPU' : 'CPU'} · ${rt.plan.sttModel} · 상한 01:00)`);
    const up = await bringUpSpeech(rt, childDeps);
    let failure: string | null = null;
    if (!up.ok) failure = `음성 인식 서버를 시작하지 못했습니다: ${up.reason ?? ''}`;
    else {
      rt.plan = { ...rt.plan, sttDevice: up.device, sttModel: up.model, deviceNote: up.note };
      if (up.note?.kind === 'FALLBACK') term.line('warn', '음성 인식을 GPU로 시작하지 못해 CPU(small)로 다시 시작했습니다', { why: up.note.reason, how: '이대로 진행하거나 GPU 드라이버·DLL 폴더를 확인한 뒤 다시 실행하세요' });
      if (up.device === 'cuda') rt.gpuActive.push('음성 인식(GPU)');
      await rt.observer?.mark('STT 적재 후');
      rt.models.push({
        role: 'speech',
        port: a.ports.mlSpeech as number,
        backend: up.health?.backend ?? 'faster-whisper',
        modelId: up.model as string, // health.modelId는 로컬 경로 — 보고서에는 모델 이름만(경로·내부 정보 제외)
        device: String(up.health?.device ?? up.device),
        computeType: String(up.health?.computeType ?? 'int8'),
        fallbackFrom: up.note?.kind === 'FALLBACK' ? 'cuda' : null,
        note: up.note ? `${up.note.kind === 'SELECTED' ? '장치 선택(auto)' : '장치 자동 대체'}: ${up.note.reason}` : undefined,
      });
      // 게이트: 합성 WAV를 API 직접 호출로 인식 → 같은 글자가 기대 의도로 답하는지
      const wav = rt.pre?.voice.wav;
      checkAbort(a.signal);
      if (wav?.ok) {
        const g1 = await gateDx1({ apiBase: a.data.apiBase, slug: ids.A.slug, origin: a.data.siteOrigin, wavPath: wav.path, expected: VOICE_PHRASE.expected, keywords: VOICE_PHRASE.keywords });
        const gate1: GateResult = { id: 'G-DX-1', scene: '장면 8', ok: g1.ok, detail: g1.detail };
        rt.gates.push(gate1);
        gateLine(term, gate1, headless);
        rt.record.speech = { expected: VOICE_PHRASE.expected, keywords: [...VOICE_PHRASE.keywords], gateTranscript: g1.transcript, gateRatio: g1.ratio, transcript: null, matchRatio: null, keywordsOk: null, intentOk: null, wavSec: wav.wav?.durationSec ?? 0, wavBytes: wav.bytes, recordedMime: null, source: 'BROWSER', listen: null, speaker: null };
        if (!g1.ok) failure = `합성 음성 인식 확인(G-DX-1)이 기대와 다릅니다: ${g1.detail}`;
        else {
          checkAbort(a.signal);
          const g2 = await gateDx2(admin1, ids.A.id, g1.transcript ?? '');
          const gate2: GateResult = { id: 'G-DX-2', scene: '장면 8', ok: g2.ok, detail: g2.detail };
          rt.gates.push(gate2);
          gateLine(term, gate2, headless);
          if (!g2.ok) failure = `인식한 글자가 기대 의도로 답하지 않습니다(G-DX-2): ${g2.detail}`;
        }
      } else failure = '합성 음성 파일이 없습니다';
    }
    checkAbort(a.signal);
    if (failure) {
      await a.supervisor.stopChild('ml-speech');
      rt.gpuActive.splice(0, rt.gpuActive.length, ...rt.gpuActive.filter((x) => !x.startsWith('음성 인식')));
      if (headless) throw new PrepareError(`음성 입력 준비 실패: ${failure}`, '무인 점검에서는 음성 인식이 없는 채로 진행하지 않습니다', `로그 ml-speech.log를 확인하세요. ${MOCK_HINT}`);
      term.line('warn', `음성 입력 장면을 생략합니다 (${failure})`, { why: '음성 인식 준비·게이트를 통과하지 못했습니다', how: '리허설에서 합성 문장을 바꾸거나(대체 문장) 모델·장치를 확인한 뒤 다시 실행하세요' });
      rt.plan = { ...rt.plan, voiceInput: 'off', sttDevice: null, sttModel: null, voiceOmittedReason: failure };
      rt.omitted.push(`음성 입력 장면을 생략합니다 (${failure})`);
      await applyVoiceSettings(admin1, ids.A.id, refundNodeId, false).catch(() => undefined);
      refreshResolved(rt);
    } else {
      term.line('pass', `음성 인식 준비: ${rt.plan.sttModel} · ${rt.plan.sttDevice === 'cuda' ? 'GPU' : 'CPU'} · 합성 음성 일치율 ${rt.record.speech?.gateRatio?.toFixed(2) ?? '?'}`);
    }
  }
  checkAbort(a.signal);
  rt.voice = makeVoiceInfo(rt);
}
