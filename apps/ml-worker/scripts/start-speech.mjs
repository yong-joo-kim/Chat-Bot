// `pnpm --filter ml-worker run start:speech` — 음성 인식 전용 프로세스(ML_WORKER_ROLE=speech, 포트 8102).
// 크로스 플랫폼 환경변수 지정을 위해 run.mjs를 감싼다. 포트는 이미 설정돼 있으면 그 값을 따른다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = {
  ...process.env,
  ML_WORKER_ROLE: 'speech',
  ML_WORKER_PORT: process.env.ML_WORKER_PORT ?? '8102',
};
const result = spawnSync(process.execPath, [join(here, 'run.mjs'), '-m', 'ml_worker.app'], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
