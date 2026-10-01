// 실행 폴더 · state.json · pids.json · 보존 정책 · 잔존 프로세스 정리(표식 확인)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRunDir,
  listRunIds,
  PidRegistry,
  pruneRunDirs,
  readPidsFile,
  readStateFile,
  resolveRunId,
  runPathsFor,
  writeStateFile,
  type RunStateFile,
} from '../src/run/run-dir';
import { cleanupResidual, isHarnessAlive, isHarnessCommandLine } from '../src/proc/residual';
import { isRunId, makeRunId, stampOf, formatMmSs, isoWithOffset } from '../src/util/time';
import { portsFor } from '../src/config';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dh-runs-'));
}

test('runId 형식 · 시각 도우미', () => {
  const id = makeRunId(new Date(2026, 9, 1, 14, 30, 12), () => 0);
  assert.equal(id, '20261001-143012-aaaa');
  assert.ok(isRunId(id));
  assert.ok(!isRunId('latest'));
  assert.ok(!isRunId('20261001-143012'));
  assert.equal(stampOf(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
  assert.equal(formatMmSs(71), '01:11');
  assert.equal(formatMmSs(-5), '00:00');
  assert.match(isoWithOffset(new Date(2026, 9, 1, 14, 30, 12)), /^2026-10-01T14:30:12[+-]\d{2}:\d{2}$/);
});

test('실행 폴더 생성: 하위 폴더 · ml-worker 작업 폴더는 빈 폴더 · 같은 ID 충돌 회피', () => {
  const root = tmp();
  try {
    const now = new Date(2026, 9, 1, 14, 30, 12);
    const a = createRunDir(root, now, () => 0);
    for (const d of [a.dir, a.logs, a.shots, a.video, a.gif, a.report, a.mlWorkerCwd]) assert.ok(existsSync(d), d);
    assert.deepEqual(readdirSync(a.mlWorkerCwd), []); // .env 없음(C-19)
    let calls = 0;
    const b = createRunDir(root, now, () => (calls++ < 4 ? 0 : 0.5)); // 처음 4번은 같은 접미 -> 충돌 -> 재시도
    assert.notEqual(a.runId, b.runId);
    assert.deepEqual(listRunIds(root), [a.runId, b.runId].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runPathsFor: DB 파일은 실행 폴더 바로 아래 demo.db', () => {
  const p = runPathsFor('/x/.demo-runs', '20261001-143012-a7k2');
  assert.equal(p.dbFile, join('/x/.demo-runs', '20261001-143012-a7k2', 'demo.db'));
  assert.equal(p.pidsFile, join(p.dir, 'pids.json'));
});

test('보존 정책: 최근 N개만 남기고 오래된 것부터 삭제, 규칙에 안 맞는 항목은 건드리지 않는다', () => {
  const root = tmp();
  try {
    const ids = ['20261001-100000-aaaa', '20261001-110000-bbbb', '20261001-120000-cccc', '20261001-130000-dddd'];
    for (const id of ids) mkdirSync(join(root, id));
    writeFileSync(join(root, '.build-stamp.json'), '{}');
    mkdirSync(join(root, '_check'));
    const r = pruneRunDirs(root, 2, ids[3]);
    assert.deepEqual(r.removed, [ids[0], ids[1]]);
    assert.deepEqual(listRunIds(root), [ids[2], ids[3]]);
    assert.ok(existsSync(join(root, '.build-stamp.json')));
    assert.ok(existsSync(join(root, '_check')));
    assert.deepEqual(pruneRunDirs(root, 5).removed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('보존 정책: 현재 실행은 가장 오래돼도 지우지 않는다', () => {
  const root = tmp();
  try {
    const ids = ['20261001-100000-aaaa', '20261001-110000-bbbb'];
    for (const id of ids) mkdirSync(join(root, id));
    const r = pruneRunDirs(root, 1, ids[0]);
    assert.deepEqual(r.removed, []);
    assert.ok(existsSync(join(root, ids[0])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('latest 해석 · 없는 ID', () => {
  const root = tmp();
  try {
    assert.equal(resolveRunId(root, 'latest'), null);
    mkdirSync(join(root, '20261001-100000-aaaa'));
    mkdirSync(join(root, '20261001-110000-bbbb'));
    assert.equal(resolveRunId(root, 'latest'), '20261001-110000-bbbb');
    assert.equal(resolveRunId(root, '20261001-100000-aaaa'), '20261001-100000-aaaa');
    assert.equal(resolveRunId(root, '20261001-999999-zzzz'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('state.json: 원자적 쓰기 · 왕복 · 비밀 제거 콜백 · 깨진 파일은 null', () => {
  const root = tmp();
  try {
    const file = join(root, 'state.json');
    const s: RunStateFile = {
      schemaVersion: 1,
      runId: 'r',
      createdAt: 'c',
      updatedAt: 'u',
      mode: 'visible',
      preset: 'customer-onprem-10m',
      ports: portsFor(0),
      phase: 'booted',
      completedSegments: ['s1'],
      state: { chatbotIds: { A: 'x' } },
      serversKept: false,
      note: '비밀 SECRET-1234 포함',
    };
    writeStateFile(file, s, (t) => t.replace('SECRET-1234', '[가림]'));
    const back = readStateFile(file)!;
    assert.equal(back.phase, 'booted');
    assert.deepEqual(back.completedSegments, ['s1']);
    assert.ok(!readFileSync(file, 'utf8').includes('SECRET-1234'));
    assert.ok(!existsSync(`${file}.tmp`));
    writeFileSync(file, '{broken');
    assert.equal(readStateFile(file), null);
    assert.equal(readStateFile(join(root, 'none.json')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pids.json: 기록 · cleanedUp 표시', () => {
  const root = tmp();
  try {
    const file = join(root, 'pids.json');
    const reg = new PidRegistry(file, 'run1');
    assert.equal(readPidsFile(file)!.cleanedUp, false);
    reg.add({ name: 'api', pid: 123, marker: 'cbdemo-api-run1' });
    reg.add({ name: 'ml-worker', pid: 456, marker: 'cbdemo_run=run1' });
    const p = readPidsFile(file)!;
    assert.deepEqual(p.entries.map((e) => e.pid), [123, 456]);
    assert.ok(p.entries[0].startedAt);
    reg.markCleanedUp();
    assert.equal(readPidsFile(file)!.cleanedUp, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function seedRun(root: string, id: string, entries: Array<{ name: string; pid: number; marker: string }>, cleanedUp = false) {
  const p = runPathsFor(root, id);
  mkdirSync(p.dir, { recursive: true });
  const reg = new PidRegistry(p.pidsFile, id);
  for (const e of entries) reg.add(e);
  if (cleanedUp) reg.markCleanedUp();
  return p;
}

test('잔존 정리(AC-DH1-5): 표식이 있는 PID만 종료, 표식이 다른 PID는 건드리지 않고 기록, 없는 PID는 이미 종료로 기록', () => {
  const root = tmp();
  try {
    const old = '20261001-100000-aaaa';
    const cur = '20261001-110000-bbbb';
    const p = seedRun(root, old, [
      { name: 'api', pid: 111, marker: `cbdemo-api-${old}` },
      { name: 'ml-worker', pid: 222, marker: `cbdemo_run=${old}` },
      { name: 'ghost', pid: 333, marker: `cbdemo_run=${old}` },
    ]);
    seedRun(root, cur, [{ name: 'api', pid: 999, marker: `cbdemo-api-${cur}` }]);
    const killed: number[] = [];
    const reports = cleanupResidual(root, { exclude: cur }, {
      queryCommandLines: () => [
        { pid: 111, ppid: 1, commandLine: `node --title=cbdemo-api-${old} -r x main.js` }, // 표식 일치
        { pid: 222, ppid: 1, commandLine: 'C:\\Windows\\notepad.exe' }, // PID 재사용(표식 없음)
      ],
      kill: (pid) => (killed.push(pid), { ok: true }),
    });
    assert.deepEqual(killed, [111]);
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], { runId: old, killed: [111], skippedNoMarker: [222], alreadyGone: [333] });
    const after = readPidsFile(p.pidsFile)!;
    assert.equal(after.cleanedUp, true);
    assert.deepEqual(after.residual?.skippedNoMarker, [222]);
    // 현재 실행은 제외
    assert.equal(readPidsFile(runPathsFor(root, cur).pidsFile)!.cleanedUp, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('잔존 정리: 이미 정리된 실행·기록 없는 실행은 건너뛴다', () => {
  const root = tmp();
  try {
    seedRun(root, '20261001-100000-aaaa', [{ name: 'api', pid: 1, marker: 'm' }], true);
    mkdirSync(join(root, '20261001-110000-bbbb')); // pids.json 없음
    let called = 0;
    const reports = cleanupResidual(root, {}, {
      queryCommandLines: () => (called++, []),
      kill: () => ({ ok: true }),
    });
    assert.deepEqual(reports, []);
    assert.equal(called, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('잔존 정리: 소유 하네스가 살아 있는 실행은 건드리지 않는다(진행 중 실행 보호) · ignoreLiveOwner면 정리', () => {
  const root = tmp();
  try {
    const id = '20261001-100000-aaaa';
    const p = seedRun(root, id, [{ name: 'api', pid: 111, marker: `cbdemo-api-${id}` }]);
    const data = readPidsFile(p.pidsFile)!;
    writeFileSync(p.pidsFile, JSON.stringify({ ...data, harnessPid: 555 }));
    const killed: number[] = [];
    const ports = {
      queryCommandLines: () => [
        { pid: 111, ppid: 555, commandLine: `node --title=cbdemo-api-${id} main.js` },
        { pid: 555, ppid: 1, commandLine: String.raw`"C:\Program Files\nodejs\node.exe" "D:\repo\tools\demo-harness\dist\src\cli.js" --prepare-only` },
      ],
      kill: (pid: number) => (killed.push(pid), { ok: true }),
    };
    const live = cleanupResidual(root, {}, ports);
    assert.deepEqual(killed, []);
    assert.equal(live[0].liveOwnerPid, 555);
    assert.equal(readPidsFile(p.pidsFile)!.cleanedUp, false, '정리됨으로 표시하지 않는다');
    const forced = cleanupResidual(root, { only: id, ignoreLiveOwner: true }, ports);
    assert.deepEqual(killed, [111]);
    assert.deepEqual(forced[0].killed, [111]);
    assert.equal(readPidsFile(p.pidsFile)!.cleanedUp, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('소유자 판정: 하네스 명령줄만(다른 node 프로세스·PID 재사용은 소유자가 아니다)', () => {
  assert.equal(isHarnessCommandLine(String.raw`"C:\nodejs\node.exe" "D:\Chat Bot\tools\demo-harness\dist\src\cli.js" --dry-run`), true);
  assert.equal(isHarnessCommandLine('node dist/src/cli.js --stop latest'), true);
  assert.equal(isHarnessCommandLine(String.raw`"C:\nodejs\node.exe" some-other-server.js`), false);
  assert.equal(isHarnessCommandLine('node other/cli.js'), false);
  assert.equal(isHarnessCommandLine(''), false);
  assert.equal(isHarnessAlive(555, { queryCommandLines: () => [], kill: () => ({ ok: true }) }), false);
});

test('pids.json에 소유 하네스 PID가 기록된다', () => {
  const root = tmp();
  try {
    const f = join(root, 'pids.json');
    new PidRegistry(f, 'r');
    assert.equal(readPidsFile(f)!.harnessPid, process.pid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
