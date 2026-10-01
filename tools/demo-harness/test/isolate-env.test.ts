// API 선적재 스크립트(설계 §13.1 · DHD-10 ③) — @prisma/client가 적재한 .env 키를 지우고, 하네스가 넘긴 키는 보존한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(__dirname, '..', '..', 'src', 'runtime', 'isolate-api-env.cjs');

function fakeApi(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dh-iso-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"fake-api"}');
  const pc = join(dir, 'node_modules', '@prisma', 'client');
  mkdirSync(pc, { recursive: true });
  writeFileSync(join(pc, 'package.json'), '{"name":"@prisma/client","main":"index.js"}');
  // 실제 @prisma/client가 require 시점에 .env를 process.env로 읽어 들이는 동작을 흉내: 이미 있는 키는 덮지 않는다
  writeFileSync(
    join(pc, 'index.js'),
    "for (const [k,v] of Object.entries({DATABASE_URL:'file:./dev.db', AUGMENTATION_GEMINI_API_KEY:'dev-secret', AUGMENTATION_TIMEOUT_MS:'1000'})) if (process.env[k]===undefined) process.env[k]=v;",
  );
  writeFileSync(join(dir, 'main.js'), 'console.log(JSON.stringify({DB:process.env.DATABASE_URL,KEY:process.env.AUGMENTATION_GEMINI_API_KEY,TO:process.env.AUGMENTATION_TIMEOUT_MS}))');
  return dir;
}

function run(dir: string, env: Record<string, string>) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? process.env.Path ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  return spawnSync(process.execPath, ['-r', SCRIPT, join(dir, 'main.js')], {
    cwd: dir,
    env: { ...base, CBDEMO_API_PACKAGE_JSON: join(dir, 'package.json'), ...env },
    encoding: 'utf8',
  });
}

test('선적재: 하네스가 넘기지 않은 .env 키는 지우고 넘긴 키(빈 문자열 포함)는 그대로 둔다', () => {
  const dir = fakeApi();
  try {
    const r = run(dir, { DATABASE_URL: 'file:D:/run/demo.db', AUGMENTATION_GEMINI_API_KEY: '' });
    assert.equal(r.status, 0, r.stderr);
    const seen = JSON.parse(r.stdout.trim());
    assert.equal(seen.DB, 'file:D:/run/demo.db', '넘긴 값 보존');
    assert.equal(seen.KEY, '', '빈 문자열 보존(.env 값이 덮지 않음)');
    assert.equal(seen.TO, undefined, '.env에서만 온 키는 삭제');
    assert.match(r.stderr, /선적재가 지운 \.env 키 이름: AUGMENTATION_TIMEOUT_MS/);
    assert.ok(!r.stderr.includes('dev-secret'), '값은 기록하지 않는다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('선적재: .env 키가 하나도 새지 않으면 (없음)으로 기록', () => {
  const dir = fakeApi();
  try {
    const r = run(dir, { DATABASE_URL: 'a', AUGMENTATION_GEMINI_API_KEY: '', AUGMENTATION_TIMEOUT_MS: '300' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /\(없음\)/);
    assert.equal(JSON.parse(r.stdout.trim()).TO, '300');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('선적재: @prisma/client를 못 찾아도 기동을 막지 않고 경고만 남긴다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-iso-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'main.js'), 'console.log("ran")');
    const r = run(dir, {});
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('ran'));
    assert.match(r.stderr, /선적재 실패/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
