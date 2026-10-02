// H-T1: 인자 해석 · 옵션 조합 오류
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, parseArgs, HELP_TEXT } from '../src/cli/args';

function ok(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  return (r as Extract<typeof r, { ok: true }>).options;
}
function errs(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.ok, false, `오류가 나야 함: ${argv.join(' ')}`);
  return (r as Extract<typeof r, { ok: false }>).errors;
}

test('기본값: 보이는 시연 · 프리셋 · 포트 오프셋 0 · msedge · 1920x1080', () => {
  const o = ok([]);
  assert.equal(o.mode, 'visible');
  assert.equal(o.preset, 'customer-onprem-10m');
  assert.equal(o.portOffset, 0);
  assert.equal(o.browser, 'msedge');
  assert.deepEqual(o.viewport, { width: 1920, height: 1080 });
  assert.equal(o.keepRuns, 5);
  assert.equal(o.only, null);
  assert.deepEqual(o.skip, []);
});

test('기본값 객체는 불변(다른 호출이 오염하지 않는다)', () => {
  const a = ok(['--skip', 'S1-06']);
  const b = ok([]);
  assert.deepEqual(a.skip, ['S1-06']);
  assert.deepEqual(b.skip, []);
  assert.deepEqual(DEFAULT_OPTIONS.skip, []);
});

test('pnpm이 넘기는 단독 -- 는 무시한다', () => {
  const o = ok(['--', '--dry-run', '--', '--verbose']);
  assert.equal(o.dryRun, true);
  assert.equal(o.verbose, true);
});

test('값 옵션: 공백 구분과 = 구분 모두 지원', () => {
  assert.equal(ok(['--port-offset', '100']).portOffset, 100);
  assert.equal(ok(['--port-offset=100']).portOffset, 100);
  assert.equal(ok(['--mode=headless-check']).mode, 'headless-check');
});

test('--only 는 소문자 구간 키만, 입력 순서와 무관하게 정의 순서로 정렬', () => {
  assert.deepEqual(ok(['--only', 's5,s1']).only, ['s1', 's5']);
  assert.deepEqual(ok(['--only', 'S1,Closing']).only, ['s1', 'closing']);
  assert.equal(errs(['--only', 's8'])[0].what.includes('--only'), true);
  assert.equal(errs(['--only', 'foo,s1']).length, 1);
});

test('--skip 은 단계 ID 형식만(대문자로 정규화)', () => {
  assert.deepEqual(ok(['--skip', 's1-06,S4-03']).skip, ['S1-06', 'S4-03']);
  assert.equal(errs(['--skip', 'S1-6']).length, 1);
  assert.equal(errs(['--skip', 'foo']).length, 1);
});

test('--resume 은 --from 과 함께만, --from 은 --resume 과 함께만', () => {
  assert.equal(errs(['--resume', 'latest']).some((e) => e.what.includes('--from')), true);
  assert.equal(errs(['--from', 'S3']).some((e) => e.what.includes('--resume')), true);
  const o = ok(['--resume', 'latest', '--from', 's3']);
  assert.equal(o.resume, 'latest');
  assert.equal(o.from, 'S3');
  assert.equal(ok(['--resume', '20261001-143012-a7k2', '--from', 'S3-04']).from, 'S3-04');
});

test('--resume/--stop 값은 실행 ID 형식 또는 latest', () => {
  assert.equal(errs(['--resume', 'abc', '--from', 'S1']).length, 1);
  assert.equal(errs(['--stop', 'abc']).length, 1);
  assert.equal(ok(['--stop', 'latest']).stop, 'latest');
  assert.equal(ok(['--stop', '20261001-143012-a7k2']).stop, '20261001-143012-a7k2');
});

test('--stop 과 --resume 은 함께 쓸 수 없다', () => {
  const e = errs(['--stop', 'latest', '--resume', 'latest', '--from', 'S1']);
  assert.equal(e.some((x) => x.what.includes('--stop과 --resume')), true);
});

test('visible 모드에서 --appendix-llm 은 오류, headless-check 에서는 허용', () => {
  assert.equal(errs(['--appendix-llm']).length, 1);
  assert.equal(ok(['--mode', 'headless-check', '--appendix-llm']).appendixLlm, true);
});

test('포트 오프셋·keep-runs·timeout·viewport·browser 범위 검사', () => {
  assert.equal(errs(['--port-offset', '-1']).length, 1);
  assert.equal(errs(['--port-offset', '60000']).length, 1);
  assert.equal(errs(['--port-offset', 'abc']).length, 1);
  assert.equal(errs(['--keep-runs', '0']).length, 1);
  assert.equal(errs(['--embedding-timeout-ms', '10']).length, 1);
  assert.equal(ok(['--embedding-timeout-ms', '800']).embeddingTimeoutMs, 800);
  assert.deepEqual(ok(['--viewport', '1600x900']).viewport, { width: 1600, height: 900 });
  assert.equal(errs(['--viewport', '1600']).length, 1);
  assert.equal(ok(['--browser', 'chrome']).browser, 'chrome');
  assert.equal(ok(['--browser', 'C:\\Program Files\\x\\browser.exe']).browser, 'C:\\Program Files\\x\\browser.exe');
  assert.equal(errs(['--browser', 'firefox']).length, 1);
});

test('알 수 없는 옵션·값 누락·불필요한 값은 3요소 오류', () => {
  for (const argv of [['--nope'], ['--mode'], ['--dry-run=1']]) {
    const e = errs(argv);
    assert.ok(e[0].what && e[0].why && e[0].how, `${argv.join(' ')}: 무엇이/왜/어떻게`);
  }
});

test('여러 오류는 모아서 한 번에 돌려준다', () => {
  assert.equal(errs(['--nope', '--port-offset', 'x', '--mode', 'bad']).length >= 3, true);
});

test('도움말 문구에 모든 주요 옵션이 있다', () => {
  for (const key of ['--mode', '--only', '--skip', '--prepare-only', '--no-teardown', '--stop', '--resume', '--port-offset', '--browser', '--dry-run']) {
    assert.ok(HELP_TEXT.includes(key), key);
  }
});

// ── 3단계 숨은 시험 인자 ──
test('숨은 시험 인자: --unattended-visible-for-test · --inject-delay (도움말에는 나오지 않는다)', () => {
  const o = ok(['--unattended-visible-for-test', '--inject-delay', 'S2-03:20,S4-01:5']);
  assert.equal(o.unattendedVisibleForTest, true);
  assert.deepEqual(o.injectDelay, { 'S2-03': 20, 'S4-01': 5 });
  assert.equal(ok([]).unattendedVisibleForTest, false);
  assert.deepEqual(ok([]).injectDelay, {});
  assert.ok(!HELP_TEXT.includes('unattended-visible-for-test') && !HELP_TEXT.includes('inject-delay'));
  assert.ok(errs(['--inject-delay', 'S2-03']).length === 1);
  assert.ok(errs(['--inject-delay', '2-03:20']).length === 1);
});
