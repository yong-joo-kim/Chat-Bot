// 빌드 지문 캐시 · pnpm 호출 계획(H-S4: shell:true는 폴백 1곳뿐)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeFingerprint, needsBuild, pathsFromPorcelain, readBuildStamp, writeBuildStamp, FINGERPRINT_PATHS, DIST_PATHS } from '../src/build/fingerprint';
import { planPnpmInvocation } from '../src/proc/pnpm';
import { BUILD_ORDER } from '../src/build/builder';
import { prismaCliPath } from '../src/proc/prisma';

test('porcelain 경로 추출: 수정·신규·이름 변경·따옴표', () => {
  const out = [' M apps/web/index.html', '?? apps/web/src/new.spec.ts', 'R  old.ts -> packages/pii-mask/src/new.ts', ' M "apps/api/src/한글 파일.ts"', ''].join('\n');
  assert.deepEqual(pathsFromPorcelain(out), ['apps/web/index.html', 'apps/web/src/new.spec.ts', 'packages/pii-mask/src/new.ts', 'apps/api/src/한글 파일.ts']);
  assert.deepEqual(pathsFromPorcelain(''), []);
});

test('needsBuild: --rebuild · 스탬프 없음 · 지문 다름이면 빌드, 같으면 생략', () => {
  const stamp = { fingerprint: 'abc', builtAt: 't' };
  assert.equal(needsBuild('abc', stamp, false), false);
  assert.equal(needsBuild('abd', stamp, false), true);
  assert.equal(needsBuild('abc', null, false), true);
  assert.equal(needsBuild('abc', stamp, true), true);
});

test('빌드 스탬프 왕복 · 깨진 파일은 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-fp-'));
  try {
    const f = join(dir, 'sub', '.build-stamp.json');
    assert.equal(readBuildStamp(f), null);
    writeBuildStamp(f, { fingerprint: 'x', builtAt: 'y' });
    assert.deepEqual(readBuildStamp(f), { fingerprint: 'x', builtAt: 'y' });
    writeFileSync(f, 'nope');
    assert.equal(readBuildStamp(f), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('지문: 같은 입력이면 같고, 변경 파일을 다시 고치면(크기·시각) 달라진다', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dh-fp-repo-'));
  try {
    const g = (...a: string[]) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    spawnSync(process.execPath, ['-e', "require('fs').mkdirSync('apps/web/src',{recursive:true});require('fs').writeFileSync('apps/web/src/a.ts','1')"], { cwd: repo });
    g('add', '-A');
    g('commit', '-qm', 'init');
    const clean = computeFingerprint(repo);
    assert.equal(computeFingerprint(repo), clean, '결정적');
    const file = join(repo, 'apps/web/src/a.ts');
    writeFileSync(file, '22');
    const dirty1 = computeFingerprint(repo);
    assert.notEqual(dirty1, clean);
    writeFileSync(file, '3333'); // porcelain 문자열(" M apps/web/src/a.ts")은 그대로지만 크기가 다르다
    const dirty2 = computeFingerprint(repo);
    assert.notEqual(dirty2, dirty1, '이미 수정된 파일을 또 고쳐도 감지');
    utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1));
    assert.notEqual(computeFingerprint(repo), dirty2, '수정 시각만 바뀌어도 감지');
    // 대상 밖 파일은 지문에 영향 없음
    writeFileSync(join(repo, 'README.md'), 'x');
    const before = computeFingerprint(repo);
    writeFileSync(join(repo, 'README.md'), 'yy');
    assert.equal(computeFingerprint(repo), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('지문 대상·dist 목록·빌드 순서는 설계 §5·§5.2와 같다', () => {
  assert.deepEqual([...FINGERPRINT_PATHS], ['packages/shared-types', 'packages/pii-mask', 'packages/dialogue-engine', 'apps/api', 'apps/web', 'apps/widget']);
  assert.deepEqual([...BUILD_ORDER], ['@chat-bot/shared-types', '@chat-bot/pii-mask', '@chat-bot/dialogue-engine', '@chat-bot/api', '@chat-bot/web', '@chat-bot/widget']);
  assert.ok(DIST_PATHS.includes('apps/api/dist/main.js') && DIST_PATHS.includes('apps/web/dist/index.html') && DIST_PATHS.includes('apps/widget/dist/widget.js'));
  assert.ok(!(FINGERPRINT_PATHS as readonly string[]).some((p) => p.startsWith('tools/')), '하네스는 지문 대상이 아니다');
});

test('pnpm 호출 계획: npm_execpath가 JS면 node로 직접(셸 0), exe면 직접, 없으면 셸 폴백(경고 대상)', () => {
  const js = planPnpmInvocation(['--filter', '@chat-bot/api', 'run', 'build'], 'C:\\pnpm\\pnpm.cjs', 'C:\\node.exe');
  assert.deepEqual(js, { command: 'C:\\node.exe', args: ['C:\\pnpm\\pnpm.cjs', '--filter', '@chat-bot/api', 'run', 'build'], shell: false, fallback: false });
  const mjs = planPnpmInvocation(['x'], '/p/pnpm.mjs', '/n');
  assert.equal(mjs.shell, false);
  const exe = planPnpmInvocation(['x'], 'C:\\pnpm\\pnpm.exe');
  assert.deepEqual([exe.command, exe.shell, exe.fallback], ['C:\\pnpm\\pnpm.exe', false, false]);
  const none = planPnpmInvocation(['--filter', 'a b', 'run', 'build'], undefined);
  assert.equal(none.shell, true);
  assert.equal(none.fallback, true);
  assert.ok(none.args.includes('"a b"'), '공백 인자는 따옴표');
  const cmd = planPnpmInvocation(['x'], 'C:\\pnpm\\pnpm.cmd'); // .cmd 래퍼는 직접 실행하지 않는다
  assert.equal(cmd.shell, true);
});

test('Prisma CLI는 .cmd 래퍼가 아니라 JS 진입점', () => {
  assert.ok(prismaCliPath('/r/apps/api').replace(/\\/g, '/').endsWith('node_modules/prisma/build/index.js'));
});
