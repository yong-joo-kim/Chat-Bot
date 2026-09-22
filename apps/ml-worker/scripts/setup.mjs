// `pnpm --filter ml-worker run setup` — venv 생성 + 의존성 설치.
// Python 3.11(권장) 또는 3.10을 찾아 .venv를 만들고 pyproject.toml의 [dev] 포함 설치를 수행한다.
// (ADR-0024 §3: "모노레포에 Python이 하나 생기는 비용"을 pnpm 스크립트로 흡수)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const venvDir = join(root, '.venv');

function tryRun(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe' });
  return r.status === 0;
}

function findBasePython() {
  // Windows py 런처 우선 확인 (여러 버전 공존 환경 대응)
  const pyLauncherCandidates = ['-3.11', '-3.10'];
  for (const v of pyLauncherCandidates) {
    if (tryRun('py', [v, '--version'])) return ['py', v];
  }
  const directCandidates = ['python3.11', 'python3.10', 'python3', 'python'];
  for (const c of directCandidates) {
    if (tryRun(c, ['--version'])) return [c];
  }
  return null;
}

if (existsSync(venvDir)) {
  console.log('[ml-worker] .venv 이미 존재 — 재사용합니다. 새로 만들려면 .venv 폴더를 지우세요.');
} else {
  const base = findBasePython();
  if (!base) {
    console.error('[ml-worker] Python 3.10/3.11을 찾을 수 없습니다. 설치 후 다시 시도하세요.');
    process.exit(1);
  }
  console.log(`[ml-worker] venv 생성: ${base.join(' ')} -m venv .venv`);
  const created = spawnSync(base[0], [...base.slice(1), '-m', 'venv', venvDir], {
    stdio: 'inherit',
    cwd: root,
  });
  if (created.status !== 0) process.exit(created.status ?? 1);
}

const venvPython = [
  join(venvDir, 'Scripts', 'python.exe'),
  join(venvDir, 'bin', 'python'),
].find((p) => existsSync(p));

console.log('[ml-worker] 의존성 설치 (torch CPU wheel 포함, 수 분 소요될 수 있습니다)...');
const installed = spawnSync(
  venvPython,
  ['-m', 'pip', 'install', '-e', '.[dev]', '--extra-index-url', 'https://download.pytorch.org/whl/cpu'],
  { stdio: 'inherit', cwd: root },
);
process.exit(installed.status ?? 1);
