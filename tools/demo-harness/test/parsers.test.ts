// H-T8: netstat · tasklist · CIM 출력 파서와 표식 판정(고정 샘플)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandLineHasMarker, listeningOnPort, parseCimJson, parseNetstat, parseTasklistCsv } from '../src/proc/parsers';

const NETSTAT = `
활성 연결

  프로토콜  로컬 주소              외부 주소              상태            PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1176
  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       12840
  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       28056
  TCP    127.0.0.1:8157         127.0.0.1:8100         TIME_WAIT       0
  TCP    [::]:5173              [::]:0                 LISTENING       777
  TCP    [::1]:5180             [::1]:50000            ESTABLISHED     888
  TCP    garbage line
`;

test('netstat: 행 파싱(IPv4·IPv6·헤더/잡음 무시)', () => {
  const rows = parseNetstat(NETSTAT);
  assert.equal(rows.length, 6);
  const api = rows.find((r) => r.localPort === 3000)!;
  assert.equal(api.localHost, '127.0.0.1');
  assert.equal(api.pid, 12840);
  assert.equal(api.state, 'LISTENING');
  const v6 = rows.find((r) => r.localPort === 5173)!;
  assert.equal(v6.localHost, '::');
  const est = rows.find((r) => r.localPort === 5180)!;
  assert.equal(est.remotePort, 50000);
});

test('netstat: 포트 점유는 LISTENING 만(TIME_WAIT·ESTABLISHED 제외)', () => {
  const rows = parseNetstat(NETSTAT);
  assert.deepEqual(listeningOnPort(rows, 3000).map((r) => r.pid), [12840]);
  assert.deepEqual(listeningOnPort(rows, 8100), []);
  assert.deepEqual(listeningOnPort(rows, 5180), []);
  assert.deepEqual(listeningOnPort(rows, 5173).map((r) => r.pid), [777]);
});

test('tasklist CSV: 일치 항목만, 현지화된 "없음" 안내 문장은 무시', () => {
  assert.deepEqual(parseTasklistCsv('"node.exe","12840","Console","1","58,224 K"\r\n'), [{ imageName: 'node.exe', pid: 12840 }]);
  assert.deepEqual(parseTasklistCsv('정보: 지정된 조건에 맞는 실행 중인 작업이 없습니다.\r\n'), []);
  assert.deepEqual(parseTasklistCsv(''), []);
});

test('CIM JSON: 객체 1개 · 배열 · 빈 출력 · 깨진 JSON', () => {
  const one = parseCimJson('{"ProcessId":5344,"ParentProcessId":20504,"Name":"python.exe","CommandLine":"python -X cbdemo_run=abc -m ml_worker.app"}');
  assert.equal(one.length, 1);
  assert.equal(one[0].pid, 5344);
  assert.equal(one[0].ppid, 20504);
  assert.ok(one[0].commandLine.includes('cbdemo_run=abc'));
  const many = parseCimJson('[{"ProcessId":1,"ParentProcessId":0,"CommandLine":null},{"ProcessId":2,"ParentProcessId":1,"CommandLine":"x"}]');
  assert.deepEqual(many.map((p) => [p.pid, p.commandLine]), [[1, ''], [2, 'x']]);
  assert.deepEqual(parseCimJson(''), []);
  assert.deepEqual(parseCimJson('   \r\n'), []);
  assert.deepEqual(parseCimJson('not json'), []);
  assert.deepEqual(parseCimJson('[{"x":1}]'), []);
});

test('표식 판정: 명령줄에 표식이 있을 때만(PID 재사용 방어)', () => {
  const marker = 'cbdemo_run=20261001-143012-a7k2';
  assert.equal(commandLineHasMarker('"D:\\venv\\python.exe" -X cbdemo_run=20261001-143012-a7k2 -m ml_worker.app', marker), true);
  assert.equal(commandLineHasMarker('"C:\\Program Files\\nodejs\\node.exe" some-other.js', marker), false);
  assert.equal(commandLineHasMarker('', marker), false);
  assert.equal(commandLineHasMarker('anything', ''), false);
  // 다른 실행의 표식은 일치하지 않는다
  assert.equal(commandLineHasMarker('python -X cbdemo_run=20261001-143012-zzzz', marker), false);
});
