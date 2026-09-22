// pnpm 스크립트가 OS에 관계없이 venv 파이썬 실행파일을 찾기 위한 헬퍼.
// Windows: .venv/Scripts/python.exe, POSIX: .venv/bin/python
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const candidates = [
  join(root, '.venv', 'Scripts', 'python.exe'),
  join(root, '.venv', 'bin', 'python'),
];
const found = candidates.find((p) => existsSync(p));

if (!found) {
  console.error(
    '[ml-worker] .venv 가 없습니다. 먼저 `pnpm --filter ml-worker run setup` 을 실행하세요.',
  );
  process.exit(1);
}

process.stdout.write(found);
