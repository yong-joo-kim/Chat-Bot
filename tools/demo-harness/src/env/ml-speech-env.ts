// [DT-2] 음성 인식 자식(ml-worker `ML_WORKER_ROLE=speech`) 환경 구성(설계 §6.2 · §6.3) — "백지 시작": 시스템 허용 키 + 아래 키만.
// ★ 이 파일은 자식 `PATH` 값을 바꾸는 유일한 곳이다(정적 검사 H-S8). 시스템 허용 키의 값을 바꾸는 단 하나의 예외 —
//   Windows에서 STT의 GPU 적재는 pip `nvidia-*` DLL 폴더가 `PATH` 앞에 있어야 한다(운영 문서 절차 `voice-ai-설계.md` §8.5를 재현할 뿐 제품 결함 우회가 아니다).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ports } from '../config';
import type { SttDevice, SttModel } from '../scenario/plan';
import { pickSystemEnv, type BuiltEnv } from './api-env';

/** venv의 `nvidia` 패키지 안 DLL 폴더 3개(순서 고정 — 설계 DXD-7). */
export const NVIDIA_DLL_SUBDIRS = ['cublas', 'cudnn', 'cuda_nvrtc'] as const;

export interface SpeechEnvInput {
  parentEnv: NodeJS.ProcessEnv;
  ports: Ports;
  /** `<저장소>/apps/ml-worker/.cache/stt-models` 절대 경로. */
  modelRoot: string;
  model: SttModel;
  device: SttDevice;
  /** `<venv>/Lib/site-packages` 절대 경로(DLL 폴더 위치). */
  sitePackages: string;
  /** 시험 주입용 — 기본은 실제 파일 시스템. */
  exists?: (p: string) => boolean;
}

const slash = (p: string): string => p.split('\\').join('/');

/** cuda일 때 `PATH` 앞에 붙일 폴더(존재하는 것만 · 이 순서). */
export function nvidiaPathPrefix(sitePackages: string, exists: (p: string) => boolean = existsSync): string[] {
  return NVIDIA_DLL_SUBDIRS.map((d) => join(sitePackages, 'nvidia', d, 'bin')).filter((p) => exists(p));
}

export function buildSpeechEnv(input: SpeechEnvInput): BuiltEnv {
  const rows: BuiltEnv['overrides'] = [];
  const env: Record<string, string> = { ...pickSystemEnv(input.parentEnv) };
  const set = (key: string, value: string, defaultValue: string, reason: string, disclosed = false) => {
    env[key] = value;
    rows.push({ key, value, defaultValue, reason, disclosed });
  };
  set('ML_WORKER_ROLE', 'speech', 'embed', '음성 인식 전용 역할(배타 — 문장 분석·생성 모델 미적재)', true);
  set('ML_WORKER_HOST', '127.0.0.1', '0.0.0.0', '루프백 바인드', true);
  set('ML_WORKER_PORT', String(input.ports.mlSpeech ?? 8102), '8100', '음성 인식 포트');
  set('STT_BACKEND', 'faster-whisper', 'mock', '실제 음성 인식(고객 시연 모의 0)', true);
  set('STT_MODEL_ID', slash(join(input.modelRoot, input.model)), '(없음)', '로컬 모델 폴더(오프라인 · 내려받기 0)', true);
  set('STT_DEVICE', input.device, 'cpu', input.device === 'cuda' ? '음성 인식 장치 GPU(이 노트북)' : '음성 인식 장치 CPU', true);
  set('STT_COMPUTE_TYPE', 'int8', 'int8', '연산 형식', true);
  set('STT_VAD', 'auto', 'auto', '무음 구간 판정(끄지 않는다)', true);
  set('CUDA_VISIBLE_DEVICES', input.device === 'cuda' ? '0' : '-1', '(미설정)', input.device === 'cuda' ? 'GPU 노출(이 프로세스만)' : 'GPU 비노출', true);
  set('HF_HUB_OFFLINE', '1', '(미설정)', '폐쇄망 — 모델 확인 요청 0', true);
  set('TRANSFORMERS_OFFLINE', '1', '(미설정)', '폐쇄망', true);
  set('HF_HUB_DISABLE_TELEMETRY', '1', '(미설정)', '원격 측정 끔');
  set('PYTHONUTF8', '1', '(미설정)', '로그 한글');
  set('PYTHONIOENCODING', 'utf-8', '(미설정)', '로그 한글');
  if (input.device === 'cuda') {
    const dirs = nvidiaPathPrefix(input.sitePackages, input.exists);
    if (dirs.length > 0) {
      // 부모 키 표기(`Path`/`PATH`)를 보존한 채 값 앞에 붙인다(뒤에 붙이면 시스템의 다른 CUDA DLL이 먼저 잡힐 수 있다)
      const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
      env[key] = `${dirs.join(';')};${env[key] ?? ''}`;
      rows.push({ key: 'PATH', value: `${dirs.length}개 폴더를 앞에 추가`, defaultValue: '부모 값 그대로', reason: '음성 인식 프로세스 PATH 앞 3경로 추가(Windows GPU DLL — 제품 코드 변경 없이 운영 문서 절차 재현)', disclosed: true });
    }
  }
  return { env, overrides: rows };
}
