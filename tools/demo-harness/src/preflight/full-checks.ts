// [DT-2] 풀 투어 사전 점검 PC-DX-1~12(설계 §5.1) — 수집은 이 파일, 판정은 voice/device.ts(순수).
// 불가 판정의 처리(A-DX-2): 보이는 시연 = 경고 + 해당 장면 생략 + 진행자 확인 · 무인 점검 = 차단 · 장치를 명시했는데 불가 = 양쪽 차단 — 호출자(오케스트레이터)가 결정한다.
// 여기서는 **하지 않는 것**: 모델 내려받기 · Ollama 설치·기동·종료 · 남의 모델 내리기(FR-0-353).
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { freemem } from 'node:os';
import type { CliOptions } from '../cli/args';
import type { RepoPaths } from '../config';
import { OLLAMA_MODEL } from '../env/ml-augment-env';
import { nvidiaPathPrefix } from '../env/ml-speech-env';
import { queryGpuList, queryGpuMemory } from '../gpu/nvidia-smi';
import { OllamaClient, OLLAMA_DEFAULT_URL } from '../llm/ollama-client';
import type { RunPaths } from '../run/run-dir';
import { decideStt, STT_MIN_FREE_VRAM_MIB, type SttDecision, type SttFacts } from '../voice/device';
import { synthesizeWav, type SynthResult } from '../voice/synth';
import { VOICE_PHRASE } from '../data/dataset-full';
import { probeFakeMic, type FakeMicProbeResult } from './fake-mic-probe';
import type { PcItem } from './checks';

const GB = 1024 ** 3;

export interface FullPreflightInput {
  paths: RepoPaths;
  options: CliOptions;
  run: RunPaths;
  env: NodeJS.ProcessEnv;
}

export interface VoicePreflight {
  /** 음성 입력을 요청했는가(`--with-voice-input` 또는 `--voice-mock-check`). */
  requested: boolean;
  mock: boolean;
  facts: SttFacts | null;
  decision: SttDecision | null;
  /** 모의 점검(mock)의 불가 사유 — 가짜 마이크·합성 음성이 필수. */
  mockUnavailable: string | null;
  wav: SynthResult | null;
  probe: FakeMicProbeResult | null;
}

export interface LlmPreflight {
  requested: boolean;
  /** 불가 사유(없으면 null) — Ollama 미기동 · 모델 없음. */
  unavailableReason: string | null;
  /** 이미 적재돼 있던 모델들(남의 모델은 내리지 않는다 · 경고). */
  loadedBefore: string[];
  sameModelLoaded: boolean;
}

export interface FullPreflightResult {
  items: PcItem[];
  voice: VoicePreflight;
  llm: LlmPreflight;
  gpuTotalMiB: number | null;
  gpuUsedMiB: number | null;
}

export const STT_MODEL_ROOT = (paths: RepoPaths): string => join(paths.mlWorkerDir, '.cache', 'stt-models');

function sttCache(root: string, name: string): boolean {
  const dir = join(root, name);
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, 'model.bin'));
  } catch {
    return false;
  }
}

/** 시스템 PATH에서 DLL 이름을 찾는다(DX-8 — 시스템 CUDA가 있으면 venv 폴더 없이도 GPU 적재가 된다). */
export function findOnPath(file: string, env: NodeJS.ProcessEnv): string | null {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const dirs = (key ? (env[key] ?? '') : '').split(delimiter).filter(Boolean);
  for (const d of dirs) {
    try {
      if (existsSync(join(d, file))) return d;
    } catch {
      /* 무시 */
    }
  }
  return null;
}

const item = (id: string, title: string, status: PcItem['status'], message: string, extra: Partial<Pick<PcItem, 'why' | 'how' | 'data'>> = {}): PcItem => ({ id, title, status, message, ...extra });

export async function runFullPreflight(i: FullPreflightInput): Promise<FullPreflightResult> {
  const { paths, options, run } = i;
  const items: PcItem[] = [];
  const voiceRequested = options.withVoiceInput || options.voiceMockCheck;
  const llmRequested = options.withLocalLlm;
  const gpuList = voiceRequested || llmRequested ? queryGpuList() : null;
  const mem = voiceRequested || llmRequested ? queryGpuMemory() : null;

  // ── 음성(PC-DX-1~8) ──
  const voice: VoicePreflight = { requested: voiceRequested, mock: options.voiceMockCheck, facts: null, decision: null, mockUnavailable: null, wav: null, probe: null };
  if (voiceRequested) {
    const root = STT_MODEL_ROOT(paths);
    // PC-DX-1 음성 선택 의존성 — 실제 STT는 mock에서는 쓰지 않는다(위젯 → API 구간만)
    let packageOk = true;
    if (!options.voiceMockCheck) {
      const r = spawnSync(paths.venvPython, ['-c', 'import faster_whisper, av'], { windowsHide: true, timeout: 30_000, encoding: 'utf8' });
      packageOk = r.status === 0;
      items.push(
        packageOk
          ? item('PC-DX-1', '음성 인식 패키지', 'pass', 'faster_whisper · av 불러오기 성공')
          : item('PC-DX-1', '음성 인식 패키지', 'warn', '음성 입력 장면을 생략합니다 (음성 인식 패키지가 없습니다)', {
              why: 'faster_whisper 또는 av를 불러오지 못했습니다',
              how: 'pip install -c requirements-lock.txt -c requirements-speech-lock.txt -e ".[speech]" (apps\\ml-worker 가상환경에서) 후 다시 실행',
              data: { unavailable: true },
            }),
      );
    }
    // PC-DX-2 STT 모델 캐시
    const turboCache = sttCache(root, 'large-v3-turbo');
    const smallCache = sttCache(root, 'small');
    if (!options.voiceMockCheck) {
      items.push(
        turboCache || smallCache
          ? item('PC-DX-2', '음성 인식 모델 캐시', 'pass', `large-v3-turbo ${turboCache ? '있음' : '없음'} · small ${smallCache ? '있음' : '없음'}`, { data: { root } })
          : item('PC-DX-2', '음성 인식 모델 캐시', 'warn', '음성 입력 장면을 생략합니다 (음성 인식 모델이 없습니다)', {
              why: 'apps\\ml-worker\\.cache\\stt-models 에 large-v3-turbo·small 폴더가 없습니다',
              how: 'fetch_stt_model.py로 모델을 반입한 뒤 다시 실행 (자동 내려받기는 하지 않습니다)',
              data: { unavailable: true },
            }),
      );
    }
    // PC-DX-3 GPU · PC-DX-5 그래픽 메모리 여유
    const gpuPresent = gpuList !== null && gpuList.length > 0;
    const freeMiB = mem ? mem.totalMiB - mem.usedMiB : null;
    if (!options.voiceMockCheck) {
      items.push(item('PC-DX-3', 'GPU(음성 인식)', 'info', gpuPresent ? `GPU 있음: ${gpuList![0]}` : 'GPU 없음(또는 nvidia-smi 없음)', { data: { gpu: gpuList ?? [] } }));
      items.push(
        freeMiB === null
          ? item('PC-DX-5', '그래픽 메모리 여유', 'info', '그래픽 메모리를 확인하지 못했습니다')
          : freeMiB >= STT_MIN_FREE_VRAM_MIB
            ? item('PC-DX-5', '그래픽 메모리 여유', 'pass', `여유 ${freeMiB}MiB (필요 ${STT_MIN_FREE_VRAM_MIB}MiB 이상 · 관찰값)`, { data: { freeMiB } })
            : item('PC-DX-5', '그래픽 메모리 여유', 'warn', `그래픽 메모리 여유가 부족합니다 (${freeMiB}MiB)`, {
                why: '음성 인식(GPU)은 1,300MiB 이상, 사내 생성 모델은 2,600MiB 이상을 권장합니다(관찰값 기준)',
                how: '다른 GPU 프로그램을 끄세요. auto이면 음성 인식은 CPU로 진행합니다',
                data: { freeMiB },
              }),
      );
    }
    // PC-DX-4 CUDA DLL — venv 폴더 또는 시스템 PATH(DX-8). 기동 시도 결과가 권위다.
    const sitePackages = join(paths.mlWorkerDir, '.venv', 'Lib', 'site-packages');
    const venvDirs = nvidiaPathPrefix(sitePackages);
    const sysCublas = findOnPath('cublas64_12.dll', i.env);
    const dllOk = venvDirs.length === 3 || sysCublas !== null;
    if (!options.voiceMockCheck) {
      items.push(
        item('PC-DX-4', 'CUDA DLL(음성 인식 GPU)', 'info', dllOk ? `venv nvidia 폴더 ${venvDirs.length}개${sysCublas ? ` · 시스템 PATH에 CUDA(${sysCublas})` : ''}` : 'venv nvidia 폴더·시스템 CUDA 모두 없음(GPU 시작은 실패할 수 있음 — 기동 시도가 최종 판정)', {
          data: { venvDirs, sysCublas },
        }),
      );
    }
    // PC-DX-7 합성 음성(먼저 — PC-DX-6 가짜 마이크가 이 파일을 쓴다)
    const wavPath = join(run.dir, 'audio', 'utterance.wav');
    const synth = synthesizeWav(VOICE_PHRASE.expected, wavPath);
    voice.wav = synth;
    const wavSec = synth.wav?.durationSec ?? 0;
    const synthOk = synth.ok && wavSec >= 1.5 && wavSec <= 12;
    items.push(
      synthOk
        ? item('PC-DX-7', '합성 음성', 'pass', `${synth.voice ?? '한국어 음성'} · ${wavSec.toFixed(1)}초 · ${synth.bytes}바이트 · ${synth.wav?.sampleRate}Hz ${synth.wav?.channels}ch ${synth.wav?.bitsPerSample}bit`, { data: { path: wavPath, bytes: synth.bytes, sec: wavSec, voice: synth.voice } })
        : item('PC-DX-7', '합성 음성', 'warn', '음성 입력 장면을 생략합니다 (합성 음성을 만들지 못했습니다)', {
            why: synth.error ?? `길이 ${wavSec.toFixed(1)}초(1.5~12초 필요)`,
            how: '설정 > 시간 및 언어 > 음성에서 한국어 음성을 설치하세요',
            data: { unavailable: true },
          }),
    );
    // PC-DX-6 가짜 마이크 + PC-DX-8 기기 안 한국어 음성
    let fakeMicOk = false;
    if (synthOk) {
      const probe = await probeFakeMic({ browser: options.browser, assetsDir: paths.assetsDir, wavPath });
      voice.probe = probe;
      fakeMicOk = probe.ok && !probe.failure;
      items.push(
        fakeMicOk
          ? item('PC-DX-6', '가짜 마이크', 'pass', `녹음 ${probe.bytes}바이트 · ${probe.mime || '형식 미확인'} · 보안 컨텍스트 ${probe.secure ? '예' : '아니오'}`, { data: { bytes: probe.bytes, mime: probe.mime } })
          : item('PC-DX-6', '가짜 마이크', 'warn', '음성 입력 장면을 생략합니다 (브라우저 가짜 마이크가 동작하지 않습니다)', {
              why: probe.failure ?? (probe.error ? `녹음 오류: ${probe.error}` : '점검 페이지에서 녹음 바이트가 0입니다'),
              how: '브라우저를 최신으로 맞추거나 --with-voice-input 없이 실행하세요',
              data: { unavailable: true },
            }),
      );
      items.push(
        item('PC-DX-8', '기기 안 한국어 읽기 음성', probe.localKo > 0 ? 'pass' : 'warn', probe.localKo > 0 ? `기기 안 한국어 음성 ${probe.localKo}개(전체 ${probe.voices}개)` : '기기 안 한국어 읽기 음성이 0개입니다 — 듣기 버튼이 비활성으로 보일 수 있습니다', {
          why: probe.localKo > 0 ? undefined : '이 브라우저에는 서버로 글자를 보내지 않는 한국어 읽기 음성이 없습니다(생략이 아니라 경고 — 장면은 정직성으로 진행)',
          how: probe.localKo > 0 ? undefined : '다른 브라우저·기기를 쓰거나 Windows 한국어 음성을 설치하세요',
          data: { voices: probe.voices, localKo: probe.localKo },
        }),
      );
    } else {
      items.push(item('PC-DX-6', '가짜 마이크', 'info', '합성 음성이 없어 점검하지 못했습니다'));
    }
    voice.facts = { packageOk, fakeMicOk, synthOk, gpuPresent, dllOk, vramFreeMiB: freeMiB, turboCache, smallCache };
    if (options.voiceMockCheck) {
      voice.mockUnavailable = !synthOk ? '합성 음성을 만들지 못했습니다' : !fakeMicOk ? '브라우저 가짜 마이크가 동작하지 않습니다' : null;
    } else {
      voice.decision = decideStt(options.sttDevice, voice.facts);
    }
  }

  // ── 사내 생성(PC-DX-9) ──
  const llm: LlmPreflight = { requested: llmRequested, unavailableReason: null, loadedBefore: [], sameModelLoaded: false };
  if (llmRequested) {
    const client = new OllamaClient(OLLAMA_DEFAULT_URL);
    const tags = await client.tags();
    const ps = await client.loaded();
    llm.loadedBefore = (ps ?? []).map((m) => m.name);
    llm.sameModelLoaded = llm.loadedBefore.includes(OLLAMA_MODEL);
    if (!tags.reachable) {
      llm.unavailableReason = 'Ollama가 응답하지 않습니다';
      items.push(
        item('PC-DX-9', 'Ollama(사내 생성 모델)', 'warn', '사내 생성 모델 장면(장면 10)을 생략합니다 (Ollama가 응답하지 않거나 모델이 없습니다)', {
          why: '127.0.0.1:11434 응답이 없습니다',
          how: 'Ollama를 실행하고 ollama list로 모델을 확인한 뒤 다시 실행하세요',
          data: { unavailable: true },
        }),
      );
    } else if (!tags.models.includes(OLLAMA_MODEL)) {
      llm.unavailableReason = `${OLLAMA_MODEL} 모델이 없습니다`;
      items.push(
        item('PC-DX-9', 'Ollama(사내 생성 모델)', 'warn', '사내 생성 모델 장면(장면 10)을 생략합니다 (Ollama가 응답하지 않거나 모델이 없습니다)', {
          why: `${OLLAMA_MODEL} 모델이 없습니다`,
          how: 'Ollama를 실행하고 ollama list로 모델을 확인한 뒤 다시 실행하세요',
          data: { unavailable: true },
        }),
      );
    } else {
      items.push(item('PC-DX-9', 'Ollama(사내 생성 모델)', 'pass', `응답 확인 · ${OLLAMA_MODEL} 있음${llm.loadedBefore.length > 0 ? ` · 지금 적재됨: ${llm.loadedBefore.join(', ')}` : ' · 지금 적재된 모델 없음'}`, { data: { models: tags.models.length } }));
      const others = llm.loadedBefore.filter((m) => m !== OLLAMA_MODEL);
      if (others.length > 0) {
        items.push(
          item('PC-DX-9b', 'Ollama 다른 모델 적재', 'warn', `Ollama에 다른 모델이 올라가 있습니다 (${others.join(', ')})`, {
            why: '그래픽 메모리를 나눠 쓰면 음성 인식이 느려지거나 시작하지 못할 수 있습니다',
            how: `ollama stop ${others[0]} 으로 내린 뒤 다시 실행하세요 (하네스는 남의 모델을 내리지 않습니다)`,
          }),
        );
      }
      if (llm.sameModelLoaded) {
        items.push(item('PC-DX-9c', 'Ollama 이전 적재', 'info', `${OLLAMA_MODEL}가 이미 적재돼 있습니다 — 하네스가 공연 뒤 이 모델을 내립니다(이전 실행이 올렸을 수 있음)`, { how: `하네스가 비정상 종료되면 모델을 내리지 못합니다: ollama stop ${OLLAMA_MODEL}` }));
      }
      const freeMiB = mem ? mem.totalMiB - mem.usedMiB : null;
      if (freeMiB !== null && freeMiB < 2600 && !llm.sameModelLoaded) {
        items.push(item('PC-DX-5b', '그래픽 메모리 여유(생성 모델)', 'warn', `그래픽 메모리 여유가 부족합니다 (${freeMiB}MiB)`, { why: '사내 생성 모델은 2,600MiB 이상을 권장합니다(관찰값 기준 2.3GB)', how: '다른 GPU 프로그램을 끄세요(모델이 CPU로 더 넘어가 생성이 느려질 수 있습니다)' }));
      }
    }
  }

  // ── RAM(PC-DX-11) ──
  const extra = (voiceRequested && !options.voiceMockCheck ? 1 : 0) + (llmRequested ? 2 : 0);
  if (extra > 0) {
    const free = freemem();
    if (free < (2 + extra) * GB) {
      items.push(item('PC-DX-11', '가용 메모리(모델 장면)', 'warn', `가용 RAM ${(free / 1e9).toFixed(1)}GB (모델 장면 포함 ${(2 + extra).toFixed(0)}GiB 이상 권장)`, { why: '음성 인식 +1GiB · 사내 생성 +2GiB 추가가 필요합니다(제안 · 미실측)', how: '브라우저 탭·IDE를 닫고 다시 실행하세요' }));
    }
  }
  return { items, voice, llm, gpuTotalMiB: mem?.totalMiB ?? null, gpuUsedMiB: mem?.usedMiB ?? null };
}
