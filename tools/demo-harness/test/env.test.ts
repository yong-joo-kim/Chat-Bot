// H-T5(환경 구성기) · H-T6(격리 DB 가드)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildApiEnv, buildMlEnv, pickSystemEnv, SYSTEM_ENV_KEYS } from '../src/env/api-env';
import { assertIsolatedDbUrl, DbGuardError, sqlitePathFromUrl, toSqliteUrl } from '../src/env/db-guard';
import { portsFor } from '../src/config';

const RUN_DIR = process.platform === 'win32' ? 'D:\\2. Team Source\\Chat Bot\\.demo-runs\\20261001-143012-a7k2' : '/repo/.demo-runs/20261001-143012-a7k2';
const DEV_DB = process.platform === 'win32' ? 'D:\\2. Team Source\\Chat Bot\\apps\\api\\prisma\\dev.db' : '/repo/apps/api/prisma/dev.db';
const API_PKG = process.platform === 'win32' ? 'D:\\2. Team Source\\Chat Bot\\apps\\api\\package.json' : '/repo/apps/api/package.json';
const ports = portsFor(0);

const DIRTY_PARENT: NodeJS.ProcessEnv = {
  Path: 'C:\\Windows',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\tmp',
  // 개발자 셸에 있을 법한 값들 — 자식에 새면 안 된다
  DATABASE_URL: 'file:./dev.db',
  AUGMENTATION_GEMINI_API_KEY: 'secret-key',
  AUGMENTATION_PROVIDER: 'gemini',
  RAG_BASE_URL: 'http://rag.example.com',
  HF_TOKEN: 'hf_secret',
  NODE_OPTIONS: '--inspect',
  npm_config_user_agent: 'pnpm',
};

function apiEnv(extra: Partial<Parameters<typeof buildApiEnv>[0]> = {}) {
  return buildApiEnv({
    parentEnv: DIRTY_PARENT,
    runDir: RUN_DIR,
    dbPath: join(RUN_DIR, 'demo.db'),
    ports,
    embeddingTimeoutMs: 300,
    apiPackageJson: API_PKG,
    ...extra,
  });
}

test('부모 env는 시스템 허용 키만 대소문자 보존으로 복사하고 나머지는 상속하지 않는다', () => {
  const picked = pickSystemEnv(DIRTY_PARENT);
  assert.deepEqual(Object.keys(picked).sort(), ['Path', 'SystemRoot', 'TEMP'].sort());
  const { env } = apiEnv();
  for (const leaked of ['HF_TOKEN', 'NODE_OPTIONS', 'npm_config_user_agent']) assert.equal(env[leaked], undefined, leaked);
  assert.ok(SYSTEM_ENV_KEYS.includes('PATH'));
});

test('개발자 셸의 제품 키를 덮어쓴다(DATABASE_URL·증강·RAG)', () => {
  const { env } = apiEnv();
  assert.notEqual(env.DATABASE_URL, 'file:./dev.db');
  assert.equal(env.AUGMENTATION_PROVIDER, 'rule');
});

test('외부 출구 키 5개는 빈 문자열로 명시된다(DHD-10 ④)', () => {
  const { env } = apiEnv();
  for (const k of ['AUGMENTATION_GEMINI_API_KEY', 'AUGMENTATION_GEMINI_BASE_URL', 'AUGMENTATION_GEMINI_MODEL', 'AUGMENTATION_LOCAL_BASE_URL', 'RAG_BASE_URL']) {
    assert.equal(env[k], '', k);
  }
});

test('.env 차단 키와 하네스 전용 키', () => {
  const { env } = apiEnv({ nodePath: '/x/.pnpm/node_modules' });
  assert.equal(env.CHATBOT_API_IGNORE_ENV_FILE, '1');
  assert.equal(env.CBDEMO_API_PACKAGE_JSON, API_PKG);
  assert.equal(env.CHECKPOINT_DISABLE, '1');
  assert.equal(env.PRISMA_HIDE_UPDATE_MESSAGE, '1');
  assert.equal(env.NODE_PATH, '/x/.pnpm/node_modules');
  assert.equal(env.NO_COLOR, '1');
});

test('기동 필수 키와 포트: 기본 · 오프셋', () => {
  const a = apiEnv().env;
  assert.equal(a.API_PORT, '3000');
  assert.equal(a.WIDGET_BASE_URL, 'http://localhost:5174');
  assert.equal(a.PUBLIC_API_BASE_URL, 'http://localhost:3000/api/v1');
  assert.equal(a.EMBEDDING_BASE_URL, 'http://127.0.0.1:8100');
  const b = apiEnv({ ports: portsFor(100) }).env;
  assert.equal(b.API_PORT, '3100');
  assert.equal(b.WIDGET_BASE_URL, 'http://localhost:5274');
  assert.equal(b.EMBEDDING_BASE_URL, 'http://127.0.0.1:8200');
  assert.equal(b.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8200');
});

test('거버넌스 ON: 저장 위치·출구 허용은 실행 폴더·루프백 1개, 암호화·디스크 선언은 설정하지 않는다', () => {
  const { env } = apiEnv();
  assert.equal(env.DATA_GOVERNANCE_MODE, 'ON');
  assert.equal(env.DATA_RESIDENCY_ALLOWED_DIRS, RUN_DIR.replace(/\\/g, '/'));
  assert.equal(env.DATA_EGRESS_ALLOWED_HOSTS, '127.0.0.1:8100');
  assert.equal(env.DATA_AT_REST_ENCRYPTION_DECLARED, undefined);
  assert.equal(env.DATA_ENCRYPTION_ENABLED, undefined);
  assert.equal(env.DATA_ENCRYPTION_KEYS, undefined);
});

test('거버넌스 OFF 폴백: 허용 목록 키를 넣지 않는다', () => {
  const { env } = apiEnv({ governanceMode: 'OFF' });
  assert.equal(env.DATA_GOVERNANCE_MODE, 'OFF');
  assert.equal(env.DATA_RESIDENCY_ALLOWED_DIRS, undefined);
  assert.equal(env.DATA_EGRESS_ALLOWED_HOSTS, undefined);
});

test('--field-encryption: 키는 환경에만 있고 공개표에서는 가려진다', () => {
  const { env, overrides } = apiEnv({ encryptionKeys: 'demo1:AAAA' });
  assert.equal(env.DATA_ENCRYPTION_ENABLED, 'true');
  assert.equal(env.DATA_ENCRYPTION_KEYS, 'demo1:AAAA');
  const row = overrides.find((r) => r.key === 'DATA_ENCRYPTION_KEYS')!;
  assert.equal(row.secret, true);
});

test('공연 무관 루프는 꺼지고 예약 엔진은 5초 폴링', () => {
  const { env } = apiEnv();
  for (const k of ['KB_SYNC_ENABLED', 'WORKFLOW_DISPATCH_ENABLED', 'DATA_RETENTION_JOB_ENABLED', 'DATA_REENCRYPT_JOB_ENABLED', 'CLASSIFIER_ENABLED', 'UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED']) {
    assert.equal(env[k], 'false', k);
  }
  assert.equal(env.DEPLOY_SCHEDULE_ENABLED, 'true');
  assert.equal(env.DEPLOY_SCHEDULE_POLL_INTERVAL_MS, '5000');
});

test('임베딩 대기 시간: 기본 300, 바뀌면 공개표 항목', () => {
  const kept = apiEnv().overrides.find((r) => r.key === 'EMBEDDING_TIMEOUT_MS')!;
  assert.equal(kept.disclosed, false);
  const raised = apiEnv({ embeddingTimeoutMs: 600 });
  assert.equal(raised.env.EMBEDDING_TIMEOUT_MS, '600');
  assert.equal(raised.overrides.find((r) => r.key === 'EMBEDDING_TIMEOUT_MS')!.disclosed, true);
});

test('환경 값은 모두 문자열이다(spawn env 규약)', () => {
  for (const v of Object.values(apiEnv().env)) assert.equal(typeof v, 'string');
  for (const v of Object.values(buildMlEnv({ parentEnv: DIRTY_PARENT, ports }).env)) assert.equal(typeof v, 'string');
});

test('ml-worker 환경: 루프백 · cpu · GPU 비노출 · 오프라인 3종 · 부모 상속 0', () => {
  const { env } = buildMlEnv({ parentEnv: DIRTY_PARENT, ports });
  assert.equal(env.ML_WORKER_HOST, '127.0.0.1');
  assert.equal(env.ML_WORKER_PORT, '8100');
  assert.equal(env.ML_WORKER_ROLE, 'embed');
  assert.equal(env.EMBEDDING_DEVICE, 'cpu');
  assert.equal(env.CUDA_VISIBLE_DEVICES, '-1');
  assert.equal(env.HF_HUB_OFFLINE, '1');
  assert.equal(env.TRANSFORMERS_OFFLINE, '1');
  assert.equal(env.HF_HUB_DISABLE_TELEMETRY, '1');
  assert.equal(env.EMBEDDING_MODEL_REVISION, 'main');
  assert.equal(env.HF_TOKEN, undefined);
  assert.equal(env.DATABASE_URL, undefined);
});

test('ml-worker 오프라인 폴백: 리비전 지정은 공개표에 오른다', () => {
  const hash = 'a'.repeat(40);
  const { env, overrides } = buildMlEnv({ parentEnv: DIRTY_PARENT, ports, modelRevision: hash });
  assert.equal(env.EMBEDDING_MODEL_REVISION, hash);
  assert.equal(overrides.find((r) => r.key === 'EMBEDDING_MODEL_REVISION')!.disclosed, true);
});

// ── H-T6 DB 가드 ──
test('DB 가드: 실행 폴더 하위 절대 경로는 통과(공백 경로 포함)', () => {
  const url = toSqliteUrl(join(RUN_DIR, 'demo.db'));
  assert.ok(url.startsWith('file:'));
  assert.ok(!url.includes('\\'));
  assert.equal(assertIsolatedDbUrl(url, RUN_DIR, DEV_DB), join(RUN_DIR, 'demo.db'));
});

test('DB 가드: dev.db 거부(경로 표기·대소문자가 달라도)', () => {
  assert.throws(() => assertIsolatedDbUrl(toSqliteUrl(DEV_DB), RUN_DIR, DEV_DB), DbGuardError);
  if (process.platform === 'win32') {
    assert.throws(() => assertIsolatedDbUrl(toSqliteUrl(DEV_DB.toUpperCase()), RUN_DIR, DEV_DB), DbGuardError);
  }
});

test('DB 가드: 상대 경로 · 원격 스킴 · 실행 폴더 밖 · 폴더 자체 · .. 탈출을 거부', () => {
  const bad = [
    'file:./dev.db',
    'file:demo.db',
    'postgresql://user:pw@db.example.com:5432/app',
    'mysql://x',
    process.platform === 'win32' ? 'file:C:/tmp/x.db' : 'file:/tmp/x.db',
    toSqliteUrl(RUN_DIR),
    toSqliteUrl(join(RUN_DIR, '..', 'other-run', 'demo.db')),
    toSqliteUrl(join(RUN_DIR, '..', '..', 'demo.db')),
    'file:',
  ];
  for (const url of bad) assert.throws(() => assertIsolatedDbUrl(url, RUN_DIR, DEV_DB), DbGuardError, url);
});

test('DB 가드 오류는 3요소(무엇이/왜/어떻게)를 가진다', () => {
  try {
    assertIsolatedDbUrl('postgresql://x', RUN_DIR, DEV_DB);
    assert.fail('던져야 함');
  } catch (e) {
    const g = e as DbGuardError;
    assert.ok(g.message && g.why && g.how);
  }
});

test('file: URL 해석: 쿼리 제거 · file:///D:/ 형태 · UNC 거부', () => {
  assert.equal(sqlitePathFromUrl('file:D:/a b/c.db?connection_limit=1'), 'D:/a b/c.db');
  assert.equal(sqlitePathFromUrl('file:///D:/a/c.db'), 'D:/a/c.db');
  assert.equal(sqlitePathFromUrl('file://server/share/c.db'), null);
  assert.equal(sqlitePathFromUrl('postgresql://x'), null);
});
