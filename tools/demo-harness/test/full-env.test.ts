// H-T21: 환경 — 10분판 API 환경 DT-1 불변 · 풀 투어 계획별 키 · NODE_ENV 부재 · 음성 자식 PATH 주입(DXD-7) · 생성 자식 · 출구 커버리지 16계획 · H-S8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { EgressExitId } from '@chat-bot/shared-types';
import { buildApiEnv, countExternalAddresses, egressCoverage, EGRESS_EXIT_COVERAGE } from '../src/env/api-env';
import { buildAugmentEnv } from '../src/env/ml-augment-env';
import { buildSpeechEnv, nvidiaPathPrefix } from '../src/env/ml-speech-env';
import { portsFor } from '../src/config';
import { PLAN_MATRIX } from '../src/scenario/plan';

const RUN_DIR = 'D:\\2. Team Source\\Chat Bot\\.demo-runs\\20261002-143012-a7k2';
const API_PKG = 'D:\\2. Team Source\\Chat Bot\\apps\\api\\package.json';
const DIRTY: NodeJS.ProcessEnv = { Path: 'C:\\Windows;C:\\CUDA\\bin', SystemRoot: 'C:\\Windows', TEMP: 'C:\\tmp', NODE_ENV: 'production', SPEECH_PROVIDER: 'local', ML_WORKER_SPEECH_URL: 'http://evil:1', AUGMENTATION_PROVIDER: 'gemini', HF_TOKEN: 'x' };

function api(plan?: { voiceInput: 'off' | 'real' | 'mock'; localLlm: boolean }, models: { augment?: boolean; speech?: boolean } = {}) {
  return buildApiEnv({ parentEnv: DIRTY, runDir: RUN_DIR, dbPath: join(RUN_DIR, 'demo.db'), ports: portsFor(0, models), embeddingTimeoutMs: 300, apiPackageJson: API_PKG, plan });
}

test('H-T21: 10분판(plan 없음) API 환경 = DT-1 — 선택 키 부재(SPEECH_PROVIDER · PROACTIVE_ENABLED) · 출구 1곳 · 증강 rule · 키 목록 고정', () => {
  const { env, overrides } = api();
  assert.equal(env.SPEECH_ENABLED, 'false');
  assert.equal(env.ML_WORKER_SPEECH_URL, '');
  assert.equal(env.AUGMENTATION_PROVIDER, 'rule');
  assert.equal(env.AUGMENTATION_LOCAL_BASE_URL, '');
  assert.equal(env.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8100');
  assert.equal('SPEECH_PROVIDER' in env, false);
  assert.equal('PROACTIVE_ENABLED' in env, false);
  assert.equal('NODE_ENV' in env, false);
  assert.equal(overrides.length, 28, '공개표 포함 전체 키 수(DT-1 3단계 기준)');
  assert.deepEqual(overrides.filter((o) => o.disclosed).length, 22);
});

test('H-T21: 풀 투어 기본 투어 — SPEECH_ENABLED=false · ML_WORKER_SPEECH_URL 빈 값 · PROACTIVE_ENABLED=true 명시 · rule · 출구 1곳', () => {
  const { env } = api({ voiceInput: 'off', localLlm: false });
  assert.equal(env.SPEECH_ENABLED, 'false');
  assert.equal(env.ML_WORKER_SPEECH_URL, '');
  assert.equal('SPEECH_PROVIDER' in env, false);
  assert.equal(env.PROACTIVE_ENABLED, 'true');
  assert.equal(env.AUGMENTATION_PROVIDER, 'rule');
  assert.equal(env.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8100');
});

test('H-T21: 음성 real · mock · 생성 켬 — 계획별 키와 DATA_EGRESS_ALLOWED_HOSTS 정확 문자열', () => {
  const real = api({ voiceInput: 'real', localLlm: false }, { speech: true }).env;
  assert.deepEqual([real.SPEECH_ENABLED, real.SPEECH_PROVIDER, real.ML_WORKER_SPEECH_URL, real.DATA_EGRESS_ALLOWED_HOSTS], ['true', 'local', 'http://127.0.0.1:8102', '127.0.0.1:8100,127.0.0.1:8102']);
  const mock = api({ voiceInput: 'mock', localLlm: false }).env;
  assert.deepEqual([mock.SPEECH_ENABLED, mock.SPEECH_PROVIDER, mock.ML_WORKER_SPEECH_URL, mock.DATA_EGRESS_ALLOWED_HOSTS], ['true', 'mock', '', '127.0.0.1:8100']);
  const llm = api({ voiceInput: 'off', localLlm: true }, { augment: true }).env;
  assert.deepEqual([llm.AUGMENTATION_PROVIDER, llm.AUGMENTATION_LOCAL_BASE_URL, llm.DATA_EGRESS_ALLOWED_HOSTS], ['local', 'http://127.0.0.1:8101', '127.0.0.1:8100,127.0.0.1:8101']);
  const all = api({ voiceInput: 'real', localLlm: true }, { augment: true, speech: true }).env;
  assert.equal(all.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8100,127.0.0.1:8102,127.0.0.1:8101');
  // 포트 오프셋도 8101·8102를 함께 옮긴다
  const off = buildApiEnv({ parentEnv: DIRTY, runDir: RUN_DIR, dbPath: join(RUN_DIR, 'demo.db'), ports: portsFor(100, { augment: true, speech: true }), embeddingTimeoutMs: 300, apiPackageJson: API_PKG, plan: { voiceInput: 'real', localLlm: true } }).env;
  assert.equal(off.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8200,127.0.0.1:8202,127.0.0.1:8201');
});

test('H-T21: 모든 계획·모든 자식에 NODE_ENV 부재(부모 셸 값이 있어도) · 개발자 셸의 SPEECH_PROVIDER·증강 키는 덮어쓴다', () => {
  for (const p of PLAN_MATRIX) {
    const { env } = api({ voiceInput: p.voiceInput, localLlm: p.localLlm });
    assert.equal('NODE_ENV' in env, false, JSON.stringify(p.voiceInput));
    if (p.voiceInput === 'off') assert.equal('SPEECH_PROVIDER' in env, false);
    assert.equal(countExternalAddresses(env), 0, '외부 주소 0(모든 계획)');
    if (!p.localLlm) assert.equal(env.AUGMENTATION_PROVIDER, 'rule');
  }
  const sp = buildSpeechEnv({ parentEnv: DIRTY, ports: portsFor(0, { speech: true }), modelRoot: 'D:\\m', model: 'small', device: 'cpu', sitePackages: 'D:\\sp' });
  const ag = buildAugmentEnv({ parentEnv: DIRTY, ports: portsFor(0, { augment: true }) });
  for (const e of [sp.env, ag.env]) {
    assert.equal('NODE_ENV' in e, false);
    assert.equal('HF_TOKEN' in e, false);
    assert.equal('SPEECH_PROVIDER' in e, false);
  }
});

test('H-T21: 음성 자식 cuda — PATH 앞에 venv DLL 3경로(존재하는 것만 · 순서 고정) · 부모 키 표기(Path) 보존 · CUDA_VISIBLE_DEVICES=0', () => {
  const sp = 'D:\\repo\\apps\\ml-worker\\.venv\\Lib\\site-packages';
  const all = (p: string) => p.startsWith(sp);
  const cuda = buildSpeechEnv({ parentEnv: DIRTY, ports: portsFor(0, { speech: true }), modelRoot: 'D:\\m', model: 'large-v3-turbo', device: 'cuda', sitePackages: sp, exists: all });
  const dirs = [`${sp}\\nvidia\\cublas\\bin`, `${sp}\\nvidia\\cudnn\\bin`, `${sp}\\nvidia\\cuda_nvrtc\\bin`];
  assert.equal(cuda.env.Path, `${dirs.join(';')};C:\\Windows;C:\\CUDA\\bin`);
  assert.equal('PATH' in cuda.env, false, '부모 키 표기 보존');
  assert.equal(cuda.env.CUDA_VISIBLE_DEVICES, '0');
  assert.equal(cuda.env.STT_DEVICE, 'cuda');
  // 일부만 존재하면 존재하는 폴더만(순서 유지)
  assert.deepEqual(nvidiaPathPrefix(sp, (p) => p.includes('cudnn') || p.includes('cuda_nvrtc')), [`${sp}\\nvidia\\cudnn\\bin`, `${sp}\\nvidia\\cuda_nvrtc\\bin`]);
  // 폴더가 하나도 없으면(시스템 CUDA 의존 — DX-8) PATH는 부모 그대로
  const none = buildSpeechEnv({ parentEnv: DIRTY, ports: portsFor(0, { speech: true }), modelRoot: 'D:\\m', model: 'large-v3-turbo', device: 'cuda', sitePackages: sp, exists: () => false });
  assert.equal(none.env.Path, 'C:\\Windows;C:\\CUDA\\bin');
  // cpu: PATH 부모 그대로 · CUDA 비노출
  const cpu = buildSpeechEnv({ parentEnv: DIRTY, ports: portsFor(0, { speech: true }), modelRoot: 'D:\\m', model: 'small', device: 'cpu', sitePackages: sp, exists: all });
  assert.equal(cpu.env.Path, 'C:\\Windows;C:\\CUDA\\bin');
  assert.equal(cpu.env.CUDA_VISIBLE_DEVICES, '-1');
  // 공통: 로컬 경로(슬래시) · VAD auto(off 금지) · 오프라인 · 루프백 · 배타 역할
  for (const e of [cuda.env, cpu.env]) {
    assert.equal(e.STT_VAD, 'auto');
    assert.equal(e.ML_WORKER_ROLE, 'speech');
    assert.equal(e.ML_WORKER_HOST, '127.0.0.1');
    assert.equal(e.ML_WORKER_PORT, '8102');
    assert.equal(e.STT_BACKEND, 'faster-whisper');
    assert.equal(e.STT_COMPUTE_TYPE, 'int8');
    assert.equal(e.HF_HUB_OFFLINE, '1');
    assert.ok(!e.STT_MODEL_ID.includes('\\'), e.STT_MODEL_ID);
    assert.equal('STT_MODEL_DIR' in e, false);
  }
  assert.equal(cuda.env.STT_MODEL_ID, 'D:/m/large-v3-turbo');
  assert.ok(cuda.overrides.some((o) => o.key === 'PATH' && o.reason.includes('PATH 앞 3경로 추가')));
});

test('H-T21: 생성 자식 — 허용 목록 · 필수 플래그 · CUDA 비노출 · 경량 구성 · 시스템 PATH 그대로', () => {
  const { env } = buildAugmentEnv({ parentEnv: DIRTY, ports: portsFor(100, { augment: true }) });
  assert.deepEqual([env.ML_WORKER_ROLE, env.ML_WORKER_PORT, env.GENERATION_BACKEND, env.OLLAMA_BASE_URL, env.OLLAMA_MODEL, env.OLLAMA_TARGET_CAP], ['augment', '8201', 'ollama', 'http://127.0.0.1:11434', 'qwen3:4b-instruct-2507-q4_K_M', '20']);
  assert.deepEqual([env.GENERATION_BACKEND_ALLOWED_HOSTS, env.GENERATION_BACKEND_REQUIRE_ALLOWLIST, env.CUDA_VISIBLE_DEVICES], ['127.0.0.1:11434', 'true', '-1']);
  assert.equal(env.Path, 'C:\\Windows;C:\\CUDA\\bin');
});

test('H-T21: egressCoverage(plan) × 제품 EgressExitId — 16개 계획 전부에서 모든 출구가 커버된다(SPEECH_LOCAL · AUGMENT_LOCAL은 계획별)', () => {
  const ids = EgressExitId.options as readonly string[];
  for (const p of PLAN_MATRIX) {
    const cov = egressCoverage({ voiceInput: p.voiceInput, localLlm: p.localLlm });
    assert.deepEqual([...ids].sort(), Object.keys(cov).sort());
    const { env } = api({ voiceInput: p.voiceInput, localLlm: p.localLlm }, { speech: p.voiceInput === 'real', augment: p.localLlm });
    for (const id of ids) {
      for (const key of cov[id].keys) {
        assert.ok(key in env, `${id}: ${key}`);
        if (cov[id].how === 'BLANK' && !/ENABLED$/.test(key)) assert.ok(env[key] === '' || env[key] === 'false', `${id}: ${key}=${env[key]}`); // 모의 점검은 SPEECH_ENABLED=true + 주소 빈 값(외부 출구 없음)
        if (cov[id].how === 'LOOPBACK' && /URL$/.test(key)) assert.match(env[key], /^http:\/\/127\.0\.0\.1:\d+$/, `${id}: ${key}`);
      }
    }
    assert.equal(cov.SPEECH_LOCAL.how, p.voiceInput === 'real' ? 'LOOPBACK' : 'BLANK');
    assert.equal(cov.AUGMENT_LOCAL.how, p.localLlm ? 'LOOPBACK' : 'BLANK');
  }
  assert.equal(egressCoverage(), EGRESS_EXIT_COVERAGE);
});

test('H-S8: 자식 PATH 값을 바꾸는 코드는 src/env/ml-speech-env.ts 1파일뿐', () => {
  const root = join(__dirname, '..', '..', 'src');
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) {
        const text = readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        if (/\.PATH\s*=[^=]|\[['"]PATH['"]\]\s*=[^=]|env\[key\]\s*=\s*`/.test(text)) hits.push(relative(root, p).split(sep).join('/'));
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, ['env/ml-speech-env.ts']);
});
