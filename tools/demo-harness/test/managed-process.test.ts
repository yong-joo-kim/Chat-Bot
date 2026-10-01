// 프로세스 관리자 — 가짜 자식(node -e)으로 spawn·로그·고리 버퍼·트리 종료·헬스 대기·Supervisor 정리를 검증한다.
// 외부 서버·제품 프로세스 불필요. 윈도(taskkill /T)와 POSIX 모두에서 동작해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedProcess } from '../src/proc/managed-process';
import { isPidAlive, killTreeSync } from '../src/proc/tree-kill';
import { waitHealthy, ProcessDiedError } from '../src/proc/health';
import { isPortFree } from '../src/proc/ports';
import { Supervisor } from '../src/proc/supervisor';
import { PidRegistry, readPidsFile } from '../src/run/run-dir';
import { WaitTimeoutError, waitFor, WaitAbortedError, sleepMs, withTimeout } from '../src/util/wait-for';
import { Redactor } from '../src/util/redact';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dh-proc-'));
}

function spec(dir: string, script: string, over: Record<string, unknown> = {}) {
  return {
    name: 'fake',
    command: process.execPath,
    args: ['-e', script],
    cwd: dir,
    env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), PATH: process.env.PATH ?? process.env.Path ?? '' } as Record<string, string>,
    logFile: join(dir, 'logs', 'fake.log'),
    marker: 'cbdemo-fake',
    ...over,
  };
}

async function untilDead(pid: number, ms = 5000): Promise<boolean> {
  return waitFor(() => !isPidAlive(pid), { timeoutMs: ms, intervalMs: 100, label: `PID ${pid} 종료` }).then(() => true, () => false);
}

test('자식 출력은 로그 파일과 마지막 N줄 고리 버퍼에 남고, 종료 코드를 안다', async () => {
  const dir = tmp();
  try {
    const p = new ManagedProcess(spec(dir, 'for (let i=1;i<=5;i++) console.log("line"+i); console.error("err1")', { ringSize: 3 }));
    await p.start();
    assert.ok(await p.waitExit(10_000));
    assert.equal(p.exitSummary, '종료 코드 0');
    const text = readFileSync(join(dir, 'logs', 'fake.log'), 'utf8');
    for (const l of ['line1', 'line5', 'err1']) assert.ok(text.includes(l), l);
    assert.equal(p.tail(10).length, 3); // 고리 버퍼 상한
    await p.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('로그·고리 버퍼는 redact를 지난다(비밀 0)', async () => {
  const dir = tmp();
  try {
    const r = new Redactor();
    r.register('TopSecret-9876');
    const p = new ManagedProcess(spec(dir, 'console.log("pw=TopSecret-9876")', { redact: (s: string) => r.redact(s) }));
    await p.start();
    await p.waitExit(10_000);
    assert.ok(!readFileSync(join(dir, 'logs', 'fake.log'), 'utf8').includes('TopSecret-9876'));
    assert.ok(!p.tail().join('\n').includes('TopSecret-9876'));
    await p.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('부모 환경은 상속하지 않는다(넘긴 env만)', async () => {
  const dir = tmp();
  try {
    process.env.DH_TEST_LEAK = 'should-not-leak';
    const p = new ManagedProcess(spec(dir, 'console.log("leak=" + (process.env.DH_TEST_LEAK ?? "none") + " own=" + process.env.OWN)', {
      env: { ...spec(dir, '').env, OWN: 'yes' },
    }));
    await p.start();
    await p.waitExit(10_000);
    assert.ok(p.tail().join('\n').includes('leak=none own=yes'), p.tail().join('|'));
  } finally {
    delete process.env.DH_TEST_LEAK;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('실행 파일이 없으면 start가 던진다(spawn 실패)', async () => {
  const dir = tmp();
  try {
    const p = new ManagedProcess({ ...spec(dir, ''), command: join(dir, 'no-such-binary.exe') });
    await assert.rejects(p.start());
    assert.ok(p.exited);
    assert.ok(p.exitSummary!.includes('실행 실패'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('트리 종료: 손자 프로세스까지 종료한다(런처-자식 구조 — venv python.exe 실측 재현)', async () => {
  const dir = tmp();
  try {
    const script = `
      const { spawn } = require('node:child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      console.log('GRANDCHILD=' + g.pid);
      setInterval(()=>{},1000);
    `;
    const p = new ManagedProcess(spec(dir, script));
    const parentPid = await p.start();
    const grand = await waitFor(() => {
      const m = /GRANDCHILD=(\d+)/.exec(p.tail().join('\n'));
      return m ? Number(m[1]) : false;
    }, { timeoutMs: 10_000, intervalMs: 100, label: '손자 PID' });
    assert.ok(isPidAlive(parentPid) && isPidAlive(grand));
    const r = await p.stop();
    assert.equal(r.killed, true);
    assert.ok(await untilDead(parentPid), '부모 종료');
    assert.ok(await untilDead(grand), '손자 종료(고아 0)');
    assert.equal(p.isAlive(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('killTreeSync: 이미 없는 PID는 성공(alreadyGone)으로 본다, 잘못된 PID는 실패', () => {
  const r = killTreeSync(2_000_000_000);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyGone, true);
  assert.equal(killTreeSync(0).ok, false);
  assert.equal(killTreeSync(-1).ok, false);
});

test('waitHealthy: 200 응답을 기다린다 · 조건 불충족이면 시간 초과 · 자식이 죽으면 즉시 실패', async () => {
  let ready = false;
  const srv = createServer((_req, res) => {
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ready ? 'ok' : 'loading', warmedUp: ready }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const base = { url: `http://127.0.0.1:${port}/health`, label: '가짜', intervalMs: 50 };
    await assert.rejects(waitHealthy({ ...base, timeoutMs: 300 }), WaitTimeoutError);
    setTimeoutFlip(() => (ready = true), 200);
    const res = await waitHealthy({ ...base, timeoutMs: 5000, accept: (r) => r.ok && (r.body as { warmedUp?: boolean })?.warmedUp === true });
    assert.equal(res.status, 200);
    const t0 = Date.now();
    await assert.rejects(waitHealthy({ url: 'http://127.0.0.1:1/', label: '죽은 자식', timeoutMs: 30_000, intervalMs: 50, hasExited: () => true }), ProcessDiedError);
    assert.ok(Date.now() - t0 < 3000, '자식이 죽었으면 시간 초과를 기다리지 않는다');
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});

function setTimeoutFlip(fn: () => void, ms: number): void {
  void sleepMs(ms).then(fn);
}

test('waitFor: 값 반환 · 취소 신호 · 라벨이 든 시간 초과 메시지 · withTimeout', async () => {
  let n = 0;
  assert.equal(await waitFor(() => (++n >= 3 ? 'done' : false), { timeoutMs: 2000, intervalMs: 10, label: 'x' }), 'done');
  const ctrl = new AbortController();
  const p = waitFor(() => false, { timeoutMs: 10_000, intervalMs: 20, label: '취소 대상', signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, WaitAbortedError);
  await assert.rejects(waitFor(() => false, { timeoutMs: 100, intervalMs: 20, label: '라벨-확인' }), /라벨-확인/);
  assert.equal(await withTimeout(sleepMs(500).then(() => 'late'), 50, 'fallback'), 'fallback');
  assert.equal(await withTimeout(Promise.resolve('fast'), 500, 'fallback'), 'fast');
});

test('포트 점검: 점유 중이면 false, 해제되면 true(IPv4·IPv6 루프백)', async () => {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  assert.equal(await isPortFree(port), false);
  await new Promise<void>((r) => srv.close(() => r()));
  assert.equal(await isPortFree(port), true);
});

test('Supervisor: 자식 기록(pids.json) · 정리 후 PID 종료 · cleanedUp 표시', async () => {
  const dir = tmp();
  try {
    const reg = new PidRegistry(join(dir, 'pids.json'), 'r1');
    const marker = `cbdemo_run=r1-${Math.random().toString(36).slice(2, 8)}`;
    const sup = new Supervisor(reg, []); // 표식 검사 대상 없음(CIM 호출 생략)
    const child = await sup.startChild(spec(dir, 'setInterval(()=>{},1000)', { name: 'api', marker }));
    assert.ok(readPidsFile(join(dir, 'pids.json'))!.entries.some((e) => e.pid === child.pid && e.marker === marker));
    assert.equal(sup.find('api'), child);
    const report = await sup.teardown({ api: 1, console: 2, widget: 3, mlWorker: 4, stage: 5 }); // 안 쓰는 포트(해제 상태)
    assert.deepEqual(report.killedChildren, ['api']);
    assert.equal(report.portsFreed, true);
    assert.equal(report.processesLeft, 0);
    assert.ok(await untilDead(child.pid!));
    assert.equal(readPidsFile(join(dir, 'pids.json'))!.cleanedUp, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Supervisor: stopChild는 한 자식만 종료하고 목록에서 뺀다', async () => {
  const dir = tmp();
  try {
    const sup = new Supervisor(new PidRegistry(join(dir, 'pids.json'), 'r2'), []);
    const a = await sup.startChild(spec(dir, 'setInterval(()=>{},1000)', { name: 'a', marker: 'ma' }));
    const b = await sup.startChild(spec(dir, 'setInterval(()=>{},1000)', { name: 'b', marker: 'mb' }));
    await sup.stopChild('a');
    assert.ok(await untilDead(a.pid!));
    assert.ok(isPidAlive(b.pid!));
    assert.equal(sup.find('a'), undefined);
    await sup.teardown({ api: 1, console: 2, widget: 3, mlWorker: 4, stage: 5 });
    assert.ok(await untilDead(b.pid!));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
