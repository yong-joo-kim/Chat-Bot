/**
 * 시험 환경 격리 — `ConfigModule.forRoot({ validate })`는 AppModule import 시점에 `.env`를 읽어 검증값을
 * 고정하므로, 로컬 `.env`의 시연용 줄(EMBEDDING_BASE_URL·CLASSIFIER_ENABLED 등)이 spec의 `beforeAll`
 * process.env 설정보다 우선해 결과가 개발자 PC마다 달라졌다. 시험에서는 `.env` 자동 로드를 끄고
 * 기동 필수 키만 여기서 채운다(선택 기능 토글은 각 spec이 명시적으로 설정한다).
 * ⚠ `@prisma/client`도 require 시점에 `.env`를 process.env로 읽어 들이므로, 여기서 먼저 require해
 *   그 적재를 소진시킨 뒤 새로 생긴 키 중 필수 키가 아닌 것을 지운다(모듈 캐시라 spec에서 재적재되지 않음).
 *   단 `new PrismaClient()`가 다시 적재할 수 있으므로, 선택 기능은 spec이 앱 생성 전에 값을 명시해야 한다.
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
