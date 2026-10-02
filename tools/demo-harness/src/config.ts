// 하네스 공통 상수·경로 계산 — 포트 5개 일괄 오프셋(설계 §6.1) · 저장소/하네스 경로.
import { join, resolve } from 'node:path';

export const BASE_PORTS = {
  api: 3000,
  console: 5173,
  widget: 5174,
  mlWorker: 8100,
  stage: 5180,
} as const;

/** [DT-2] 풀 투어의 모델 자식 포트 — 해당 플래그를 켠 실행에서만 `Ports`에 들어간다(10분판은 5개 그대로). */
export const MODEL_PORTS = {
  mlAugment: 8101,
  mlSpeech: 8102,
} as const;

export type BasePortName = keyof typeof BASE_PORTS;
export type ModelPortName = keyof typeof MODEL_PORTS;
export type PortName = BasePortName | ModelPortName;
export type Ports = Record<BasePortName, number> & Partial<Record<ModelPortName, number>>;

export function portsFor(offset: number, models: { augment?: boolean; speech?: boolean } = {}): Ports {
  const p = {} as Ports;
  for (const k of Object.keys(BASE_PORTS) as BasePortName[]) p[k] = BASE_PORTS[k] + offset;
  if (models.augment) p.mlAugment = MODEL_PORTS.mlAugment + offset;
  if (models.speech) p.mlSpeech = MODEL_PORTS.mlSpeech + offset;
  return p;
}

export const PORT_LABELS: Record<PortName, string> = {
  api: 'API',
  console: '관리 콘솔(정적 서버)',
  widget: '위젯(정적 서버)',
  mlWorker: '문장 분석 서버(ml-worker)',
  stage: '무대·고객사 모형(정적 서버)',
  mlAugment: '사내 생성 서버(ml-worker 생성 역할)',
  mlSpeech: '음성 인식 서버(ml-worker 음성 역할)',
};

/** 하네스 패키지 루트(tools/demo-harness) — 컴파일 산출물(dist/src/*.js)과 소스(src/*.ts) 모두에서 같은 값. */
export function harnessRoot(): string {
  return resolve(__dirname, '..', '..');
}

/** 저장소 루트(Chat Bot). */
export function repoRoot(): string {
  return resolve(harnessRoot(), '..', '..');
}

export interface RepoPaths {
  repo: string;
  harness: string;
  apiDir: string;
  apiDist: string;
  apiMain: string;
  apiPackageJson: string;
  devDb: string;
  webDist: string;
  widgetDist: string;
  mlWorkerDir: string;
  venvPython: string;
  isolateScript: string;
  assetsDir: string;
  defaultRunsDir: string;
}

export function repoPaths(repo: string = repoRoot()): RepoPaths {
  const harness = join(repo, 'tools', 'demo-harness');
  const apiDir = join(repo, 'apps', 'api');
  const mlWorkerDir = join(repo, 'apps', 'ml-worker');
  return {
    repo,
    harness,
    apiDir,
    apiDist: join(apiDir, 'dist'),
    apiMain: join(apiDir, 'dist', 'main.js'),
    apiPackageJson: join(apiDir, 'package.json'),
    devDb: join(apiDir, 'prisma', 'dev.db'),
    webDist: join(repo, 'apps', 'web', 'dist'),
    widgetDist: join(repo, 'apps', 'widget', 'dist'),
    mlWorkerDir,
    venvPython: join(mlWorkerDir, '.venv', 'Scripts', 'python.exe'),
    isolateScript: join(harness, 'src', 'runtime', 'isolate-api-env.cjs'),
    assetsDir: join(harness, 'assets'),
    defaultRunsDir: join(repo, '.demo-runs'),
  };
}

/** 헬스 대기·기동 시간 상한(설계 §5). */
export const TIMEOUTS = {
  mlWorkerWarmupMs: 180_000,
  apiHealthMs: 60_000,
  staticHealthMs: 10_000,
  portFreeMs: 5_000,
  teardownMs: 5_000,
} as const;
