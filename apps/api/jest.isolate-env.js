/**
 * 시험 환경 격리 — `ConfigModule.forRoot({ validate })`는 AppModule import 시점에 `.env`를 읽어 검증값을
 * 고정하므로, 로컬 `.env`의 시연용 줄(EMBEDDING_BASE_URL·CLASSIFIER_ENABLED 등)이 spec의 `beforeAll`
 * process.env 설정보다 우선해 결과가 개발자 PC마다 달라졌다. 시험에서는 `.env` 자동 로드를 끄고
 * 기동 필수 키만 여기서 채운다(선택 기능 토글은 각 spec이 명시적으로 설정한다).
 * ⚠ `@prisma/client`도 require 시점에 `.env`를 process.env로 읽어 들이므로, 여기서 먼저 require해
 *   그 적재를 소진시킨 뒤 새로 생긴 키 중 필수 키가 아닌 것을 지운다(모듈 캐시라 spec에서 재적재되지 않음).
 *   단 `new PrismaClient()`가 다시 적재할 수 있으므로, 선택 기능은 spec이 앱 생성 전에 값을 명시해야 한다.
 *
 * [코드리뷰 2회차 M-1, 2026-09] ⚠ 실측 확인: `ConfigModule.forRoot({ validate })`가 만드는
 * `ConfigService` 스냅샷은 **AppModule 클래스가 정의되는 시점**(= 그 파일을 처음 `require`하는
 * 시점)에 이미 고정된다. spec 파일 최상단의 `import { AppModule } from '../app.module'`(정적
 * import)은 그 spec 파일의 다른 어떤 코드(예: `beforeAll` 안의 `process.env.X = 'false'`)보다도
 * 먼저 실행되므로, **정적 import를 쓰는 spec에서 `beforeAll`에 넣은 `process.env.X` 값은
 * 스키마에 선언된 키에 한해 무시된다**(직접 프로브로 확인 — `DEPLOY_SCHEDULE_ENABLED='false'`를
 * `beforeAll`에서 설정해도 정적 import spec에서는 `ConfigService.get()`이 `true`를 반환했다).
 * 이 파일(`setupFiles`)은 spec 파일의 최상단 import보다도 먼저 실행되므로, 백그라운드 타이머
 * 스위치의 시험 기본값은 **여기서만** 안전하게 고정할 수 있다. 타이머가 실제로 필요한 spec은
 * `await import('../app.module')`(동적 import, `scheduled-deploy.integration.spec.ts` 등 선례)로
 * 바꾸고 그 안에서 `process.env.X = 'true'`를 먼저 설정해야 한다 — 정적 import를 유지한 채
 * `beforeAll`에서 값을 바꾸는 방식은 효과가 없다.
 */
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const REQUIRED_KEYS = ['DATABASE_URL', 'WIDGET_BASE_URL', 'PUBLIC_API_BASE_URL'];
const DEFAULTS = {
  DATABASE_URL: 'file:./dev.db',
  WIDGET_BASE_URL: 'http://localhost:5174',
  PUBLIC_API_BASE_URL: 'http://localhost:3000/api/v1',
};

const before = new Set(Object.keys(process.env));
require('@prisma/client');
for (const key of Object.keys(process.env)) {
  if (!before.has(key) && !REQUIRED_KEYS.includes(key)) delete process.env[key];
}

const fromFile = {};
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) fromFile[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

for (const key of REQUIRED_KEYS) {
  if (process.env[key] === undefined) process.env[key] = fromFile[key] ?? DEFAULTS[key];
}
process.env.CHATBOT_API_IGNORE_ENV_FILE = '1';

// [코드리뷰 2회차 M-1] 하이브리드 CS(No.24) 정리 루프 — AppModule을 로드하는 모든 통합 시험에
// 60초 백그라운드 타이머·쿼리가 생기지 않게 기본값을 끈다. 루프 자체를 검증해야 하는 spec은
// `HandoffSweeperService.tick()`/`runOnce()`를 직접 호출한다(타이머 대기 없이 결정론적).
process.env.HANDOFF_SWEEPER_ENABLED = 'false';

// 운영 예약 배포(No.28) 실행 엔진도 같은 이유로 기본값을 끈다. 통합 spec들이 `beforeAll`에서
// `DEPLOY_SCHEDULE_ENABLED='false'`를 설정해 왔지만, 정적 `import { AppModule }` spec에서는
// ConfigModule 스냅샷이 import 시점에 고정돼 효과가 없었다(2026-09-25 실측 — 10개 spec에서 30초 폴링이
// 계속 돌고 있었음). 엔진 동작 검증은 `DeploySchedulesEngine.tick()` 직접 호출로 한다.
process.env.DEPLOY_SCHEDULE_ENABLED = 'false';

// 데이터 거버넌스(No.45) 파기·재암호화 잡도 같은 이유로 기본값을 끈다(기존 루프 규약). 잡 동작
// 검증은 `RetentionJob.tick()`/`FieldCryptoJob.tick()` 직접 호출로 한다.
process.env.DATA_RETENTION_JOB_ENABLED = 'false';
process.env.DATA_REENCRYPT_JOB_ENABLED = 'false';
