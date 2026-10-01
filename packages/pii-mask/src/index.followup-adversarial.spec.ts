import * as ts from 'typescript';
import { maskPii, type PiiMaskResult } from './index';

// 이 패키지는 @types/node 를 두지 않는다 — 시험 파일 안에서만 최소 선언
declare const require: (m: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
declare const console: { log: (...a: unknown[]) => void };
const fs = require('fs');
const path = require('path');

/**
 * [후속 결함 6건 최종 회귀 · 적대적 확인 — test-automation 2026-10-01]
 * 오라클 = HEAD(규칙 v2) 의 index.ts 소스를 그대로 동결한 `__golden__/index.v2-head.ts.txt`.
 * 구현과 코드를 공유하지 않는다(구 EMAIL_REGEX·RRN_REGEX·CARD_REGEX 도 이 동결본 안에 있다).
 */
type MaskFn = (text: string, options?: { mode?: 'PARTIAL' | 'FULL'; kinds?: readonly string[] }) => PiiMaskResult;
type Counts = PiiMaskResult['counts'];

/**
 * 개정 ① — 규칙 v3 = v2 다섯 단계 + 맨 뒤 ⑥ 카드 보강(설계 §2.3). 아래 `refReinforce`는 구현 모듈과 **코드를 공유하지 않는** 독립 작성본이다
 * (표지 문자 없이 문자열 스캔으로 구현). 표기는 모두 이번 호출이 만든 것이라고 가정한다 — 퍼징 입력에 `[`가 없다.
 */
const TOK_RRN = '[주민등록번호]';
const TOK_CARD = '[카드번호]';
function refReinforce(text: string, counts: Counts): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let j = i;
    let digits = 0;
    let rrn = 0;
    let card = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch >= '0' && ch <= '9') {
        digits += 1;
        j += 1;
      } else if (text.startsWith(TOK_RRN, j)) {
        rrn += 1;
        j += TOK_RRN.length;
      } else if (text.startsWith(TOK_CARD, j)) {
        card += 1;
        j += TOK_CARD.length;
      } else break;
    }
    if (j === i) {
      out += text[i];
      i += 1;
      continue;
    }
    if (rrn + card > 0 && digits > 0) {
      counts.rrn -= rrn;
      counts.card += 1 - card;
      out += TOK_CARD;
    } else out += text.slice(i, j);
    i = j;
  }
  return out
    .replace(/(?<!\d)\d{14,}(?!\d)/g, () => {
      counts.card += 1;
      return TOK_CARD;
    })
    .replace(/(?<!\d)\d{4} \d{6} \d{5}(?!\d)/g, () => {
      counts.card += 1;
      return TOK_CARD;
    });
}

function loadV2Oracle(): { plain: MaskFn; reinforced: MaskFn } {
  const src = fs.readFileSync(path.join(__dirname, '__golden__', 'index.v2-head.ts.txt'), 'utf8');
  // 선택 경로: 자리표시 복원 직전(⑥ 위치)에 보강 훅을 주입한다 — 자리표시는 숫자도 표기도 아니므로 덩어리를 끊는다.
  const anchor = 'masked = masked.replace(PLACEHOLDER_REGEX,';
  if (src.split(anchor).length !== 2) throw new Error('v2 오라클 소스에서 자리표시 복원 앵커를 찾지 못했다');
  const hooked = src.replace(anchor, `if (selected.has('card')) masked = __reinforce(masked, counts);\n  ${anchor}`);
  const load = (code: string): MaskFn => {
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', '__reinforce', js)(mod, mod.exports, refReinforce);
    return mod.exports.maskPii as MaskFn;
  };
  const plain = load(src);
  const hookedFn = load(hooked);
  const reinforced: MaskFn = (text, options) => {
    if (options?.kinds !== undefined) return hookedFn(text, options);
    const r = plain(text, options);
    const counts = { ...r.counts };
    return { maskedText: refReinforce(r.maskedText, counts), counts };
  };
  return { plain, reinforced };
}
const oracles = loadV2Oracle();
const v2 = oracles.plain;
const v3Oracle = oracles.reinforced;

const MODES = ['PARTIAL', 'FULL'] as const;
const digitsOf = (s: string): string => s.replace(/\D/g, '');

describe('(a) 새던 입력 — 카드로 전량 가림 · 원문 숫자 잔존 0', () => {
  const LEAKS: string[] = [
    '4111111111111111',
    '4111-1111-1111-1111',
    '4111 1111 1111 1111',
    '378282246310005',
    '3782 822463 10005',
    '12345678901234', // 14
    '1234567890123456789', // 19
    '12345678901234567890', // 20
    '123456789012345678901234567890', // 30
    '9'.repeat(64),
  ];
  for (const mode of MODES) {
    it.each(LEAKS)(`${mode} — %s`, (raw) => {
      for (const text of [raw, `카드 ${raw} 결제`, `[${raw}]`, `x${raw}y`, `${raw}, ${raw}`]) {
        const r = maskPii(text, { mode });
        expect(r.maskedText).toContain('[카드번호]');
        expect(digitsOf(r.maskedText)).toBe(''); // 원문 숫자 0
        expect(r.counts.rrn).toBe(0);
        expect(r.counts.card).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('(a-2) AMEX 하이픈형 — 계좌 표기로 전량 가림(개정 ①: 카드 표기 아님 · v2와 같음)', () => {
  for (const mode of MODES) {
    it(`${mode} — 원문 숫자 0`, () => {
      for (const text of ['3782-822463-10005', '카드 3782-822463-10005 결제', '[3782-822463-10005]']) {
        const r = maskPii(text, { mode });
        expect(digitsOf(r.maskedText)).toBe('');
        expect(r).toEqual(v2(text, { mode }));
      }
    });
  }
});

describe('(b) 정상 입력은 v2와 동일', () => {
  const NORMAL = [
    '9001011234567', '900101-1234567', '9001011234567 연락', '주민 900101-2345678 입니다',
    '01012345678', '010-1234-5678', '011-234-5678', '02-123-4567', '031-1234-5678',
    '1002-123-456789', '110-123-456789', '123-45-67890', '12-345-6789-0',
    '2026-09-30', '2026-09-30 접수', '생년월일 1990-05-12', '생일: 1990-05-12 입니다', '1990-05-12',
    '1234-5678-9012-3456', '1234 5678 9012 3456', '1234-5678-9012-345', '1234567890123', // 13: v2 도 주민
    'a@b.co', 'hong.gildong+tag@example.co.kr', '문의 x@y.com1@z.com 끝', '1234560123456',
    '', ' ', '숫자 없음', '12345', '123456789012', '1', '0'.repeat(12),
  ];
  for (const mode of MODES) {
    it.each(NORMAL)(`${mode} — 수작업 입력 %j == v2`, (t) => {
      expect(maskPii(t, { mode })).toEqual(v2(t, { mode }));
    });
  }

  it('생년월일 문맥 말뭉치 106건: 두 모드 모두 v2 오라클과 동일', () => {
    const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '__golden__', 'birth-context-corpus.json'), 'utf8')) as {
      cases: Array<{ text: string }>;
    };
    expect(corpus.cases).toHaveLength(106);
    for (const c of corpus.cases) {
      for (const mode of MODES) expect(maskPii(c.text, { mode })).toEqual(v2(c.text, { mode }));
    }
  });

  it('오라클 퍼징 300,000건 × 2모드 — maskPii(s) == 보강(v2(s)) (문자열·카운트) · 원문 숫자 v3 <= v2', () => {
    // 의사난수(고정 시드) — 숫자 비중 높게 + 구분자 + 글자. 입력에 `[`가 없으므로 모든 표기는 이번 호출 것이다.
    let seed = 20261001;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '7', '9', '-', ' ', '-', 'a', '가', '.', '@', '\n'];
    let samples = 0;
    let changedVsV2 = 0;
    let worseDigits = 0;
    for (let i = 0; i < 300_000; i++) {
      const len = Math.floor(rnd() * 49);
      let t = '';
      for (let k = 0; k < len; k++) t += alphabet[Math.floor(rnd() * alphabet.length)];
      for (const mode of MODES) {
        samples++;
        const a = maskPii(t, { mode });
        const b = v2(t, { mode });
        const expected = v3Oracle(t, { mode });
        if (JSON.stringify(a) !== JSON.stringify(expected)) expect({ t, mode, a }).toEqual({ t, mode, a: expected });
        if (a.maskedText !== b.maskedText) changedVsV2++;
        if (digitsOf(a.maskedText).length > digitsOf(b.maskedText).length) worseDigits++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[adversarial] 오라클 퍼징 표본=${samples} (v2와 출력이 달라진 건수=${changedVsV2}) 원문 숫자를 v2보다 더 남긴 건수=${worseDigits}`);
    expect(samples).toBe(600_000);
    expect(changedVsV2).toBeGreaterThan(1000);
    expect(worseDigits).toBe(0);
  }, 240_000);

  it('생년월일 문맥·날짜·전화·이메일이 섞인 오라클 퍼징 100,000건 — 표지 방식이 ③~⑤ 판정을 v2와 똑같이 유지한다', () => {
    let seed = 77;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pieces = ['4111111111111111', '900101-1234567', '9001011234567', '1234 5678 9012 3456', '3782 822463 10005', '2026-09-30', '1990-05-12', '생일', '생년월일', ':', ' ', ' ', '-', '1', '7', '010-1234-5678', 'a@b.co', 'x', '가', '(양력)', '\n', '110-234-567890', '12', '5678'];
    let samples = 0;
    for (let i = 0; i < 100_000; i++) {
      const n = Math.floor(rnd() * 9);
      let t = '';
      for (let k = 0; k < n; k++) t += pieces[Math.floor(rnd() * pieces.length)];
      for (const mode of MODES) {
        samples++;
        const a = maskPii(t, { mode });
        const expected = v3Oracle(t, { mode });
        if (JSON.stringify(a) !== JSON.stringify(expected)) expect({ t, mode, a }).toEqual({ t, mode, a: expected });
      }
    }
    expect(samples).toBe(200_000);
  }, 240_000);

  it('kinds 6조합 × 표본 50,000 — maskPii(s,{kinds}) == 보강(v2(s,{kinds})) · card 미선택이면 v2와 같다 · 원문 숫자 v3 <= v2', () => {
    const combos: string[][] = [
      ['rrn', 'card', 'phone', 'account', 'email'],
      ['rrn', 'card'],
      ['card'],
      ['rrn'],
      ['account'],
      [],
    ];
    let seed = 4242;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '7', '-', ' ', '-', 'a', '가', '.', '@', '\n'];
    let samples = 0;
    let worseDigits = 0;
    for (let i = 0; i < 50_000; i++) {
      const len = Math.floor(rnd() * 49);
      let t = '';
      for (let k = 0; k < len; k++) t += alphabet[Math.floor(rnd() * alphabet.length)];
      for (const kinds of combos) {
        samples++;
        const a = maskPii(t, { mode: 'PARTIAL', kinds: kinds as never });
        const b = v2(t, { mode: 'PARTIAL', kinds });
        const expected = kinds.includes('card') ? v3Oracle(t, { mode: 'PARTIAL', kinds }) : b;
        if (JSON.stringify(a) !== JSON.stringify(expected)) expect({ t, kinds, a }).toEqual({ t, kinds, a: expected });
        if (digitsOf(a.maskedText).length > digitsOf(b.maskedText).length) worseDigits++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[adversarial] kinds 6조합 표본=${samples} 원문 숫자를 v2보다 더 남긴 건수=${worseDigits}`);
    expect(samples).toBe(300_000);
    expect(worseDigits).toBe(0);
  }, 240_000);
});

describe('(c) Q-1 오탐 영향 — 14자리 이상 연속 숫자는 모두 [카드번호]', () => {
  const FP: Array<[string, string]> = [
    ['주문번호(14)', '주문번호 20260930123456'],
    ['주문번호(16)', '주문 2026093012345678'],
    ['운송장(12)', '운송장 123456789012'],
    ['운송장(14)', '운송장 12345678901234'],
    ['운송장(16)', '운송장 1234567890123456'],
    ['사업자번호(하이픈)', '사업자 123-45-67890'],
    ['사업자번호(연속10)', '사업자 1234567890'],
    ['법인등록번호(13 연속)', '법인 1101111234567'],
    ['법인등록번호(하이픈)', '법인 110111-1234567'],
    ['epoch ms(13)', 'ts=1700000000000'],
    ['epoch us(16)', 'ts=1700000000000000'],
    ['epoch ns(19)', 'ts=1700000000000000000'],
    ['시리얼(20)', 'SN 00000000000000000001'],
    ['날짜시각(14)', '20260930123456 기록'],
    ['날짜시각(17 ms)', '20260930123456789'],
  ];
  it.each(FP)('%s — v3 결과 기록', (_label, text) => {
    const a = maskPii(text);
    const b = v2(text);
    // 14자리 이상 연속은 v3 에서 전부 카드, 그 아래는 v2 와 같다
    if (/\d{14,}/.test(text)) {
      expect(digitsOf(a.maskedText)).toBe('');
      expect(a.counts.card).toBe(1);
    } else {
      expect(a).toEqual(b);
    }
  });
});

describe('(d) L-6 이메일 성능·동치', () => {
  const cases: Array<[string, string]> = [
    ['a×1e6', 'a'.repeat(1_000_000)],
    ["'1-'×1e5", '1-'.repeat(100_000)],
  ];
  it.each(cases)('%s — 각 입력 PARTIAL+FULL 이 3초 안', (_n, input) => {
    const t0 = Date.now();
    for (const mode of MODES) maskPii(input, { mode });
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[adversarial] ${_n} 2모드 합계 ${ms}ms`);
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('작은 크기(구 정규식이 감당하는 길이)에서 v2 오라클과 결과 동일', () => {
    for (const input of ['a'.repeat(3000), '1-'.repeat(1500), 'a'.repeat(2000) + '@b.co', 'x@y.com1@z.com', ('a.'.repeat(500)) + '@d.io']) {
      for (const mode of MODES) expect(maskPii(input, { mode })).toEqual(v2(input, { mode }));
    }
  });
});
