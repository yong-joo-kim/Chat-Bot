// 하네스 단위 시험 실행기 — dist/test 아래 *.test.js를 모아 `node --test`로 실행한다.
// (셸 글롭에 의존하지 않아 윈도 cmd에서도 동작하고, Node 20/24 모두 호환)
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'dist', 'test');

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const files = collect(testDir).sort();
if (files.length === 0) {
  console.error('시험 파일(dist/test/**/*.test.js)이 없습니다. 먼저 pnpm run harness:build 를 실행하세요.');
  process.exit(1);
}
const extra = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
