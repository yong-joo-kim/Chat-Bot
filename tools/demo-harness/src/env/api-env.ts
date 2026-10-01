// API·ml-worker 자식 프로세스 환경 구성(설계 §6.2~§6.4) — "백지 시작": 부모 process.env의 나머지는 상속하지 않는다.
// 하네스 프로세스가 Prisma 클라이언트를 require하며 `.env`를 읽어 들였더라도 자식에 새지 않는다(DHD-10 ①).
import type { Ports } from '../config';
import { toSqliteUrl } from './db-guard';

/** 자식에게 넘길 수 있는 시스템 필수 키 허용 목록(설계 §6.2). 윈도 환경변수 이름은 대소문자를 구분하지 않는다. */
export const SYSTEM_ENV_KEYS = [
  'SystemRoot',
  'windir',
  'ComSpec',
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
] as const;

export interface OverrideRow {
  key: string;
  value: string;
  /** 제품 기본값(문서용 문자열). */
  defaultValue: string;
  reason: string;
  /** 시연 설정 공개표(보고서 §17.2-6 · 외부 송신 점검표)에 싣는 항목 — 설계 §6.2 "공개표 ★". */
  disclosed: boolean;
  /** 값이 비밀이라 공개표에서 가린다. */
  secret?: boolean;
}

export interface BuiltEnv {
  env: Record<string, string>;
  overrides: OverrideRow[];
}

/** 부모 env에서 시스템 허용 키만 골라 (부모의 키 대소문자를 보존해) 새 객체로 만든다. */
export function pickSystemEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  const lowerToActual = new Map<string, string>();
  for (const k of Object.keys(parent)) lowerToActual.set(k.toLowerCase(), k);
  for (const want of SYSTEM_ENV_KEYS) {
    const actual = lowerToActual.get(want.toLowerCase());
    const v = actual !== undefined ? parent[actual] : undefined;
    if (actual !== undefined && v !== undefined) out[actual] = v;
  }
  return out;
}

export interface ApiEnvInput {
  parentEnv: NodeJS.ProcessEnv;
  runDir: string;
  /** 절대 경로의 격리 DB 파일(db-guard 통과값). */
  dbPath: string;
  ports: Ports;
  /** 잠정값 300 또는 실측 결정값(§14). */
  embeddingTimeoutMs: number;
  /** `--field-encryption`일 때만 — 실행별 무작위 키(`demo1:<base64>`). */
  encryptionKeys?: string;
  /** 거버넌스 모드 — 기본 ON. 기동 실패 시 OFF 재기동(EX-DH-12). */
  governanceMode?: 'ON' | 'OFF';
  /** `apps/api/package.json` 절대 경로(선적재 스크립트가 @prisma/client를 이 기준으로 해석). */
  apiPackageJson: string;
  /**
   * pnpm 모듈 해석 경로(`<저장소>/node_modules/.pnpm/node_modules`). pnpm 실행 래퍼(.bin 셸·`pnpm run`)는 NODE_PATH에 이 경로를
   * 넣어 주는데, `node dist/main.js`를 직접 띄우면 빠져 `multer`(apps/api가 직접 의존성으로 선언하지 않은 값 import)를 못 찾고 죽는다
   * (2026-10-01 실측). 하네스는 제품 의존성 선언을 바꾸지 않고 같은 경로를 NODE_PATH로 넘긴다.
   */
  nodePath?: string;
}

export function buildApiEnv(input: ApiEnvInput): BuiltEnv {
  const { ports } = input;
  const runDirSlash = input.runDir.replace(/\\/g, '/');
  const governance = input.governanceMode ?? 'ON';
  const rows: OverrideRow[] = [];
  const env: Record<string, string> = { ...pickSystemEnv(input.parentEnv) };

  const set = (key: string, value: string, defaultValue: string, reason: string, disclosed = false, secret = false) => {
    env[key] = value;
    rows.push({ key, value, defaultValue, reason, disclosed, secret });
  };

  set('DATABASE_URL', toSqliteUrl(input.dbPath), '(없음)', '격리 DB(실행 폴더)', true);
  set('API_PORT', String(ports.api), '3000', '기동 필수');
  set('WIDGET_BASE_URL', `http://localhost:${ports.widget}`, '(없음)', '기동 필수');
  set('PUBLIC_API_BASE_URL', `http://localhost:${ports.api}/api/v1`, '(없음)', '기동 필수');
  set('CHATBOT_API_IGNORE_ENV_FILE', '1', '미설정', '개발자 .env 차단(DHD-10 2)', true);
  set('EMBEDDING_BASE_URL', `http://127.0.0.1:${ports.mlWorker}`, '미설정', '의미 매칭·분석(루프백)', true);
  set('EMBEDDING_TIMEOUT_MS', String(input.embeddingTimeoutMs), '300', '단건 질의 예산(설계 §14)', input.embeddingTimeoutMs !== 300);
  set('EMBEDDING_BATCH_TIMEOUT_MS', '30000', '30000', '배치 예산 명시');
  set('AUGMENTATION_PROVIDER', 'rule', 'rule', '증강 = 규칙 기반(G1)', true);
  // DHD-10 4: 값 없는 선택 출구 키는 빈 문자열로 명시 — 어떤 .env 로더도 덮어쓰지 않는다.
  for (const k of [
    'AUGMENTATION_GEMINI_API_KEY',
    'AUGMENTATION_GEMINI_BASE_URL',
    'AUGMENTATION_GEMINI_MODEL',
    'AUGMENTATION_LOCAL_BASE_URL',
    'RAG_BASE_URL',
  ]) {
    set(k, '', '미설정', '외부 출구 키 빈 값 고정(DHD-10 4)', true);
  }
  // 공연과 무관한 루프 차단
  const loopRows: Array<[string, string, string]> = [
    ['KB_SYNC_ENABLED', 'false', 'false'],
    ['WORKFLOW_DISPATCH_ENABLED', 'false', 'true'],
    ['DATA_RETENTION_JOB_ENABLED', 'false', 'true'],
    ['DATA_REENCRYPT_JOB_ENABLED', 'false', 'true'],
    ['CLASSIFIER_ENABLED', 'false', 'false'],
    ['UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED', 'false', 'false'],
  ];
  for (const [k, v, d] of loopRows) set(k, v, d, '공연 무관 루프 차단', true);
  set('DEPLOY_SCHEDULE_ENABLED', 'true', 'true', '예약 배포 엔진(장면 5)', true);
  set('DEPLOY_SCHEDULE_POLL_INTERVAL_MS', '5000', '30000', '예약 폴링 허용 최소값(장면 5)', true);
  set('HANDOFF_SWEEPER_ENABLED', 'true', 'true', '상담 정리 루프(장면 2)');

  set('DATA_GOVERNANCE_MODE', governance, 'OFF', '데이터 거버넌스 모드(구축형 강조)', true);
  if (governance === 'ON') {
    set('DATA_RESIDENCY_ALLOWED_DIRS', runDirSlash, '(빈 값)', '저장 위치 허용(실행 폴더)', true);
    set('DATA_EGRESS_ALLOWED_HOSTS', `127.0.0.1:${ports.mlWorker}`, '(빈 값)', '출구 허용 1개(루프백)', true);
  }
  // DATA_AT_REST_ENCRYPTION_DECLARED는 설정하지 않는다(정직성 — 설계 §6.2).
  if (input.encryptionKeys) {
    set('DATA_ENCRYPTION_ENABLED', 'true', 'false', '필드 암호화(--field-encryption)', true);
    set('DATA_ENCRYPTION_KEYS', input.encryptionKeys, '(없음)', '실행별 키', true, true);
  }

  // 하네스 전용 키(제품 설정 스키마 밖 — 제품 동작 영향 0) 및 Prisma 폐쇄망 설정
  env.CBDEMO_API_PACKAGE_JSON = input.apiPackageJson;
  if (input.nodePath) env.NODE_PATH = input.nodePath;
  env.NO_COLOR = '1'; // Nest 로그의 ANSI 색 코드를 로그 파일에 남기지 않는다
  env.CHECKPOINT_DISABLE = '1';
  env.PRISMA_HIDE_UPDATE_MESSAGE = '1';

  return { env, overrides: rows };
}

export interface MlEnvInput {
  parentEnv: NodeJS.ProcessEnv;
  ports: Ports;
  /** 오프라인 로드가 실패했을 때만 하네스가 넘기는 refs/main 커밋 해시(확인 1 폴백). */
  modelRevision?: string;
}

export function buildMlEnv(input: MlEnvInput): BuiltEnv {
  const rows: OverrideRow[] = [];
  const env: Record<string, string> = { ...pickSystemEnv(input.parentEnv) };
  const set = (key: string, value: string, defaultValue: string, reason: string, disclosed = false) => {
    env[key] = value;
    rows.push({ key, value, defaultValue, reason, disclosed });
  };
  set('ML_WORKER_HOST', '127.0.0.1', '0.0.0.0', '루프백 바인드', true);
  set('ML_WORKER_PORT', String(input.ports.mlWorker), '8100', '포트');
  set('ML_WORKER_ROLE', 'embed', 'embed', '생성 모델 미적재');
  set('EMBEDDING_MODEL_ID', 'nlpai-lab/KURE-v1', 'nlpai-lab/KURE-v1', '모델');
  set('EMBEDDING_MODEL_REVISION', input.modelRevision ?? 'main', 'main', input.modelRevision ? '오프라인 폴백: refs/main 커밋 해시 지정' : '모델 리비전', input.modelRevision !== undefined);
  set('EMBEDDING_DEVICE', 'cpu', 'cpu', '장치 cpu', true);
  set('CUDA_VISIBLE_DEVICES', '-1', '(미설정)', 'GPU 비노출(/health.device는 설정값 메아리)', true);
  set('HF_HUB_OFFLINE', '1', '(미설정)', '폐쇄망 — 모델 확인 요청 0', true);
  set('TRANSFORMERS_OFFLINE', '1', '(미설정)', '폐쇄망', true);
  set('HF_HUB_DISABLE_TELEMETRY', '1', '(미설정)', '원격 측정 끔');
  set('PYTHONUTF8', '1', '(미설정)', '로그 한글');
  set('PYTHONIOENCODING', 'utf-8', '(미설정)', '로그 한글');
  return { env, overrides: rows };
}
