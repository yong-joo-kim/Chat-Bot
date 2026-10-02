// 진행자 제어(설계 §4.4): 키·줄 명령 해석 · 상태 전이(엔터 시작 · 일시정지 · 핵심 단계 n 무시 · q 확인 · 마무리 q · 입력 종료 자동 시작)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { interpretKeys, interpretLine, keyHelpLine, PresenterControl, type PresenterInput } from '../src/control/presenter';

class FakeInput extends EventEmitter implements PresenterInput {
  raw: boolean | null = null;
  paused = false;
  setEncoding(): void {}
  setRawMode(on: boolean): void {
    this.raw = on;
  }
  resume(): void {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
}

function make(mode: 'keys' | 'lines' = 'keys') {
  const input = new FakeInput();
  const said: string[] = [];
  let quit = 0;
  let interrupt = 0;
  const c = new PresenterControl({
    mode,
    input,
    say: (kind, text) => said.push(`${kind}:${text}`),
    onQuit: () => quit++,
    onInterrupt: () => interrupt++,
  });
  return { c, input, said, counts: () => ({ quit, interrupt }) };
}

test('원시 키 해석: Enter · Space · n · s · q · y · Ctrl+C · 기타', () => {
  assert.deepEqual(interpretKeys('\r\n n s q y\u0003x'), ['ENTER', 'ENTER', 'PAUSE', 'SKIP_STEP', 'PAUSE', 'NEXT_SEGMENT', 'PAUSE', 'QUIT', 'PAUSE', 'YES', 'INTERRUPT', 'OTHER']);
  assert.deepEqual(interpretKeys('N S Q Y'), ['SKIP_STEP', 'PAUSE', 'NEXT_SEGMENT', 'PAUSE', 'QUIT', 'PAUSE', 'YES']);
});

test('줄 명령 해석: 빈 줄=엔터 · p · n · s · q · y', () => {
  assert.equal(interpretLine(''), 'ENTER');
  assert.equal(interpretLine('  '), 'ENTER');
  assert.equal(interpretLine('p'), 'PAUSE');
  assert.equal(interpretLine('N'), 'SKIP_STEP');
  assert.equal(interpretLine('s'), 'NEXT_SEGMENT');
  assert.equal(interpretLine('q'), 'QUIT');
  assert.equal(interpretLine('y'), 'YES');
  assert.equal(interpretLine('zzz'), 'OTHER');
});

test('키 안내 줄은 모드에 따라 키 또는 줄 명령 문구', () => {
  assert.match(keyHelpLine('keys'), /Space 일시정지/);
  assert.match(keyHelpLine('lines'), /p=일시정지/);
});

test('attach: 키 모드는 원시 모드를 켜고 detach에서 원복한다', () => {
  const { c, input } = make('keys');
  c.attach();
  assert.equal(input.raw, true);
  c.detach();
  assert.equal(input.raw, false);
  assert.equal(input.paused, true);
});

test('엔터 대기: 엔터 전 키는 무시하고 엔터로 시작한다', async () => {
  const { c, input } = make();
  c.attach();
  const started = c.waitForStart();
  input.emit('data', ' ns'); // 시작 전 일시정지·건너뛰기·다음 구간은 무시
  assert.equal(c.paused, false);
  assert.equal(c.consumeSkipStep(), false);
  assert.equal(c.consumeSkipSegment(), false);
  input.emit('data', '\r');
  await started;
  assert.equal(c.started, true);
  c.detach();
});

test('일시정지 토글과 pause 이벤트', () => {
  const { c } = make();
  const events: boolean[] = [];
  c.on('pause', (p: boolean) => events.push(p));
  c.press('ENTER');
  c.press('PAUSE');
  assert.equal(c.paused, true);
  c.press('PAUSE');
  assert.equal(c.paused, false);
  assert.deepEqual(events, [true, false]);
});

test('n: 핵심 단계는 무시하고 안내, 생략 가능 단계는 건너뛰기 요청을 남긴다', () => {
  const { c, said } = make();
  c.press('ENTER');
  c.setCurrent({ stepId: 'S3-02', skippable: false });
  c.press('SKIP_STEP');
  assert.equal(c.consumeSkipStep(), false);
  assert.ok(said.some((s) => s.includes('핵심 장면은 건너뛸 수 없습니다 (S3-02)')));
  let skipEvents = 0;
  c.on('skip', () => skipEvents++);
  c.setCurrent({ stepId: 'S3-04', skippable: true });
  c.press('SKIP_STEP');
  assert.equal(skipEvents, 1);
  assert.equal(c.consumeSkipStep(), true);
  assert.equal(c.consumeSkipStep(), false, '한 번 쓰면 사라진다');
});

test('s: 다음 구간 요청', () => {
  const { c } = make();
  c.press('ENTER');
  c.press('NEXT_SEGMENT');
  assert.equal(c.consumeSkipSegment(), true);
  assert.equal(c.consumeSkipSegment(), false);
});

test('q → y 는 종료(onQuit), q → 그 외 키는 계속', () => {
  const { c, counts, said } = make();
  c.press('ENTER');
  c.press('QUIT');
  assert.ok(said.some((s) => s.startsWith('confirm:')));
  c.press('PAUSE'); // 확인 대기 중 다른 키 = 취소
  assert.equal(counts().quit, 0);
  assert.equal(c.paused, false, '취소로 소비된 키는 다른 동작을 하지 않는다');
  c.press('QUIT');
  c.press('YES');
  assert.equal(counts().quit, 1);
});

test('Ctrl+C(원시 모드)는 onInterrupt로 같은 정리 경로를 탄다', () => {
  const { c, counts, input } = make();
  c.attach();
  input.emit('data', '\u0003');
  assert.equal(counts().interrupt, 1);
  c.detach();
});

test('마무리 대기: q는 확인 없이 끝낸다', async () => {
  const { c } = make();
  c.press('ENTER');
  const done = c.waitForFinish();
  c.press('PAUSE');
  c.press('QUIT');
  await done;
});

test('줄 명령 모드: 줄 단위로 처리하고 나뉘어 도착한 입력도 이어 붙인다', async () => {
  const { c, input } = make('lines');
  c.attach();
  const started = c.waitForStart();
  input.emit('data', '\r');
  input.emit('data', '\n');
  await started;
  input.emit('data', 'p');
  assert.equal(c.paused, false, '줄이 끝나기 전에는 처리하지 않는다');
  input.emit('data', '\n');
  assert.equal(c.paused, true);
  c.detach();
});

test('표준 입력이 닫히면 엔터 대기를 자동 시작으로 풀고 안내한다', async () => {
  const { c, input, said } = make();
  c.attach();
  const started = c.waitForStart();
  input.emit('end');
  await started;
  assert.ok(said.some((s) => s.startsWith('warn:') && s.includes('자동으로 시작')));
});
