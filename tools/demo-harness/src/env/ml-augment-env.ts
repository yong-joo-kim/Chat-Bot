// [DT-2] 생성 자식(ml-worker `ML_WORKER_ROLE=augment` · Ollama 경량 구성) 환경 구성(설계 §6.2) — "백지 시작".
// 이 프로세스는 GPU를 쓰지 않는다(`CUDA_VISIBLE_DEVICES=-1` — 연산은 Ollama가 한다 · `/augment/health.device='external'`).
import type { Ports } from '../config';
import { pickSystemEnv, type BuiltEnv } from './api-env';

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

export interface AugmentEnvInput {
  parentEnv: NodeJS.ProcessEnv;
  ports: Ports;
}

export function buildAugmentEnv(input: AugmentEnvInput): BuiltEnv {
  const rows: BuiltEnv['overrides'] = [];
  const env: Record<string, string> = { ...pickSystemEnv(input.parentEnv) };
  const set = (key: string, value: string, defaultValue: string, reason: string, disclosed = false) => {
    env[key] = value;
    rows.push({ key, value, defaultValue, reason, disclosed });
  };
  set('ML_WORKER_ROLE', 'augment', 'embed', '생성 전용 역할(배타 — 문장 분석·음성 모델 미적재)', true);
  set('ML_WORKER_HOST', '127.0.0.1', '0.0.0.0', '루프백 바인드', true);
  set('ML_WORKER_PORT', String(input.ports.mlAugment ?? 8101), '8100', '사내 생성 포트');
  set('GENERATION_BACKEND', 'ollama', 'transformers', '경량 설치 구성(Ollama) — 동작 확인 수준', true);
  set('OLLAMA_BASE_URL', OLLAMA_BASE_URL, '(없음)', '사용자 PC의 Ollama(루프백 고정)', true);
  set('OLLAMA_MODEL', OLLAMA_MODEL, '(없음)', '시연 모델(4B · 4비트)', true);
  set('OLLAMA_TARGET_CAP', '20', 'min(20, 60)', '경량 구성 1회 생성 상한(명시)', true);
  set('GENERATION_BACKEND_ALLOWED_HOSTS', '127.0.0.1:11434', '(빈 값)', '생성 백엔드 주소 통제(루프백도 목록 필수)', true);
  set('GENERATION_BACKEND_REQUIRE_ALLOWLIST', 'true', 'false', '허용 목록 필수(거버넌스 설치 권장값)', true);
  set('CUDA_VISIBLE_DEVICES', '-1', '(미설정)', 'GPU 비노출(이 프로세스는 GPU를 쓰지 않는다 — 연산은 Ollama)', true);
  set('HF_HUB_OFFLINE', '1', '(미설정)', '폐쇄망', true);
  set('TRANSFORMERS_OFFLINE', '1', '(미설정)', '폐쇄망', true);
  set('HF_HUB_DISABLE_TELEMETRY', '1', '(미설정)', '원격 측정 끔');
  set('PYTHONUTF8', '1', '(미설정)', '로그 한글');
  set('PYTHONIOENCODING', 'utf-8', '(미설정)', '로그 한글');
  return { env, overrides: rows };
}
