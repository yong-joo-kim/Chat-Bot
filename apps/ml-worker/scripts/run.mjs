// `pnpm --filter ml-worker run dev|start|test|eval:sweep` 이 이 스크립트를 통해
// venv 파이썬을 실행한다. 팀의 명령어 체계(`pnpm <script>`)를 Python 프로세스에도 통일한다
// (ADR-0024 §3-3).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const venvPython = [
  join(root, '.venv', 'Scripts', 'python.exe'),
  join(root, '.venv', 'bin', 'python'),
].find((p) => existsSync(p));

if (!venvPython) {
  console.error(
    '[ml-worker] .venv 가 없습니다. 먼저 `pnpm --filter ml-worker run setup` 을 실행하세요.',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(venvPython, args, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
