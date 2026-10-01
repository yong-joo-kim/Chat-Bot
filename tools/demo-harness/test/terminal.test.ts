// 터미널 출력 규칙(ui-spec §9.1·§9.5): 한글 표시 폭 · 78칸 · 라벨 · 3요소 오류 · 색 비의존 · 비밀 제거 · 로그 파일
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { displayWidth, dotLeader, padEndWidth, padStartWidth, wrapByWidth } from '../src/util/display-width';
import { LABEL_TEXT, Terminal } from '../src/log/terminal';
import { Redactor } from '../src/util/redact';

class Sink {
  chunks: string[] = [];
  isTTY = false;
  write(s: string) {
    this.chunks.push(s);
    return true;
  }
  get text() {
    return this.chunks.join('');
  }
}

test('표시 폭: 한글·전각 2칸, ASCII 1칸, 결합·제로폭 0칸', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('가나다'), 6);
  assert.equal(displayWidth('a가'), 3);
  assert.equal(displayWidth('ＡＢ'), 4);
  assert.equal(displayWidth('漢字'), 4);
  assert.equal(displayWidth('é'), 1);
  assert.equal(displayWidth('a​b'), 2);
  assert.equal(displayWidth(''), 0);
});

test('패딩: 문자 수가 아니라 표시 폭 기준', () => {
  assert.equal(displayWidth(padEndWidth('가', 6)), 6);
  assert.equal(displayWidth(padStartWidth('가', 6)), 6);
  assert.equal(padEndWidth('가나다', 4), '가나다'); // 넘으면 그대로
});

test('줄바꿈: 모든 줄이 폭 이하, 둘째 줄부터 들여쓰기, 한글 낱말 강제 분할', () => {
  const text = '이것은 아주 긴 한국어 문장으로 표시 폭 기준 줄바꿈이 제대로 되는지 확인하기 위한 예시입니다 abc def ghi';
  const lines = wrapByWidth(text, 30, '    ');
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(displayWidth(l) <= 30, `${displayWidth(l)}: ${l}`);
  assert.ok(lines.slice(1).every((l) => l.startsWith('    ')));
  const noSpace = wrapByWidth('가'.repeat(50), 20);
  for (const l of noSpace) assert.ok(displayWidth(l) <= 20);
  assert.equal(noSpace.join(''), '가'.repeat(50));
});

test('점선 채움 줄: 78칸 이하', () => {
  const l = dotLeader('[1/6] 사전 점검', '완료 (00:08)', 78);
  assert.equal(displayWidth(l), 78);
  assert.ok(l.startsWith('[1/6] 사전 점검 .'));
  assert.ok(l.endsWith('완료 (00:08)'));
});

test('라벨 어휘 9종은 대괄호 글자(색 비의존)', () => {
  assert.deepEqual(Object.values(LABEL_TEXT).sort(), ['[건너뜀]', '[대체]', '[실패]', '[오류]', '[정보]', '[주의]', '[지연]', '[진행]', '[통과]'].sort());
});

test('3요소 오류: 무엇이 / 왜: / 조치: 접두, 78칸 이하', () => {
  const sink = new Sink();
  const t = new Terminal({ out: sink, width: 78 });
  t.line('error', '포트 3000을 다른 프로그램이 사용 중입니다 (PID 12840 node.exe)', {
    why: '이전 개발 서버나 다른 앱이 같은 포트를 쓰고 있습니다',
    how: '해당 프로그램을 끄거나  pnpm demo -- --port-offset 100  으로 포트를 옮기세요',
  });
  const lines = sink.text.trimEnd().split('\n');
  assert.ok(lines[0].startsWith('[오류] 포트 3000'));
  assert.ok(lines.some((l) => l.trim().startsWith('왜:')));
  assert.ok(lines.some((l) => l.trim().startsWith('조치:')));
  for (const l of lines) assert.ok(displayWidth(l) <= 78, `${displayWidth(l)}: ${l}`);
});

test('색: 비TTY·color=false이면 ANSI 코드 0, color=true이면 라벨 글자만 칠한다', () => {
  const plain = new Sink();
  new Terminal({ out: plain, color: false }).line('pass', '확인');
  assert.ok(!plain.text.includes('\u001b['));
  const colored = new Sink();
  new Terminal({ out: colored, color: true }).line('pass', '확인');
  assert.ok(colored.text.includes('\u001b[32m[통과]\u001b[0m 확인'));
});

test('--verbose 아닐 때 detail은 터미널에 안 나오고 로그 파일에는 남는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-term-'));
  try {
    const logFile = join(dir, 'logs', 'harness.log');
    const sink = new Sink();
    const t = new Terminal({ out: sink, logFile, verbose: false, now: () => new Date(2026, 9, 1, 14, 36, 2) });
    t.detail('상세 정보');
    t.line('info', '일반 정보');
    assert.ok(!sink.text.includes('상세 정보'));
    const log = readFileSync(logFile, 'utf8');
    assert.ok(log.includes('14:36:02 ') && log.includes('상세 정보') && log.includes('[정보] 일반 정보'));
    assert.ok(!log.includes('\u001b['));
    const sink2 = new Sink();
    new Terminal({ out: sink2, verbose: true }).detail('상세 정보');
    assert.ok(sink2.text.includes('상세 정보'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('비밀 제거: 터미널과 로그 파일 모두 redact를 지난다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-term-'));
  try {
    const r = new Redactor();
    r.register('Sup3r!Secret-pw');
    const logFile = join(dir, 'h.log');
    const sink = new Sink();
    const t = new Terminal({ out: sink, logFile, redact: (s) => r.redact(s) });
    t.line('info', '비밀번호는 Sup3r!Secret-pw 입니다');
    assert.ok(!sink.text.includes('Sup3r!Secret-pw'));
    assert.ok(!readFileSync(logFile, 'utf8').includes('Sup3r!Secret-pw'));
    assert.ok(sink.text.includes('[가림]'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stepLine: 상태 어휘와 소요 시간', () => {
  const sink = new Sink();
  new Terminal({ out: sink }).stepLine(3, 6, '빌드', '생략');
  assert.ok(sink.text.trimEnd().endsWith('생략'));
  const s2 = new Sink();
  new Terminal({ out: s2 }).stepLine(1, 6, '사전 점검', '완료', '00:08');
  assert.ok(s2.text.includes('완료 (00:08)'));
});

test('출력 파이프가 닫혀 write가 던져도(EPIPE) 하네스는 죽지 않고 로그 파일에는 남는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-term-'));
  try {
    const logFile = join(dir, 'h.log');
    const broken = {
      isTTY: false,
      write() {
        throw new Error('write EPIPE');
      },
      on() {
        return undefined;
      },
    };
    const t = new Terminal({ out: broken, logFile });
    assert.doesNotThrow(() => t.line('info', '파이프가 닫힌 뒤의 출력'));
    assert.ok(readFileSync(logFile, 'utf8').includes('파이프가 닫힌 뒤의 출력'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
