import * as ts from 'typescript';
import { maskPii, type PiiMaskResult } from './index';

declare const require: (m: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
declare const console: { log: (...a: unknown[]) => void };
const fs = require('fs');
const path = require('path');

/**
 * [T-5 개정본(v2 정규식 복원 + ⑥ 카드 보강) 재검증 — test-automation 2026-10-01]
 * 오라클 = HEAD v2 동결본(`__golden__/index.v2-head.ts.txt`). 구현 모듈과 코드를 공유하지 않는다.
 * 이 파일은 기존 index.followup-adversarial.spec.ts 와 다른 시드·다른 알파벳(대괄호·사설영역 문자 포함)으로 독립 퍼징한다.
 */
type MaskFn = (t: string, o?: { mode?: 'PARTIAL' | 'FULL'; kinds?: readonly string[] }) => PiiMaskResult;
const src = fs.readFileSync(path.join(__dirname, '__golden__', 'index.v2-head.ts.txt'), 'utf8');
const v2 = ((): MaskFn => {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports.maskPii as MaskFn;
})();

const MODES = ['PARTIAL', 'FULL'] as const;
const nd = (s: string): number => s.replace(/\D/g, '').length;

const LEAKY: Array<[string, string]> = [
  ['L1', '4111111111111111-1234567'],
  ['L2', '주문 20260930123456-1234567'],
  ['L3', '123456-1234567890123456'],
  ['L4', '12900101-1234567'],
  ['L5', '1900101-1234567'],
  ['L6', '1234567890123456789-1234567'],
  ['L7', '12345678901234567 5678 9012 3456'],
  ['N1', '900101-1234567'],
  ['N2', 'a900101-1234567'],
  ['N3', '9001011234567'],
  ['P1', '010-1234-5678'],
  ['P2', '01012345678'],
  ['P3', '02-123-4567'],
  ['A1', '110-123-456789'],
  ['A2', '1002-123-456789'],
  ['D1', '2026-09-30 접수'],
  ['D2', '생년월일 1990-05-12'],
  ['D3', '생일: 1990-05-12 입니다'],
  ['X1', '9001011234567-1234567'],
  ['X2', '900101-12345678'],
  ['X3', '4111-1111-1111-1111-1234567'],
  ['X4', '3782 822463 10005'],
  ['X5', '3782-822463-10005'],
  ['X6', '4111111111111111'],
];

describe('(1) 새던 입력 표 — 원문 숫자가 v2보다 더 남지 않는다', () => {
  it('출력 표 기록 + 불변식', () => {
    const rows: string[] = [];
    for (const [id, t] of LEAKY) {
      for (const mode of MODES) {
        const a = maskPii(t, { mode });
        const b = v2(t, { mode });
        rows.push(`${id}|${mode}|${JSON.stringify(t)}|v2=${JSON.stringify(b.maskedText)}(${nd(b.maskedText)})|v3=${JSON.stringify(a.maskedText)}(${nd(a.maskedText)})|${JSON.stringify(a.counts)}`);
        expect(nd(a.maskedText)).toBeLessThanOrEqual(nd(b.maskedText));
      }
    }
    // eslint-disable-next-line no-console
    console.log('[recheck-table]\n' + rows.join('\n'));
  });

  it('106건 문맥 말뭉치 — 두 모드 v2와 동일', () => {
    const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '__golden__', 'birth-context-corpus.json'), 'utf8')) as { cases: Array<{ text: string }> };
    expect(corpus.cases).toHaveLength(106);
    for (const c of corpus.cases) for (const mode of MODES) expect(maskPii(c.text, { mode })).toEqual(v2(c.text, { mode }));
  });

  it('1900101-1234567 판정 — 설계 §2.5 #7 = [카드번호] (지시의 `1[주민등록번호]`는 v2 출력이다)', () => {
    const t = '1900101-1234567';
    for (const mode of MODES) {
      expect(v2(t, { mode }).maskedText).toBe('1[주민등록번호]');
      expect(maskPii(t, { mode }).maskedText).toBe('[카드번호]');
      expect(maskPii(t, { mode }).counts).toEqual({ rrn: 0, card: 1, account: 0, phone: 0, email: 0 });
    }
  });
});

describe('(2) 사설 영역 U+E200~E2FF 입력', () => {
  const chars = ['', '', '', ''];
  const bases = ['4111111111111111', '900101-1234567', '1900101-1234567', '12345678901234567 5678 9012 3456', '3782 822463 10005', '카드 4111111111111111 결제', '010-1234-5678 a@b.co'];
  it('기본 호출 = v2 출력(문자열·카운트)', () => {
    for (const c of chars) for (const b of bases) for (const t of [c + b, b + c, b.slice(0, 5) + c + b.slice(5), c]) for (const mode of MODES) expect(maskPii(t, { mode })).toEqual(v2(t, { mode }));
  });
  it('선택 경로(kinds) — 원문 숫자는 v2 선택 경로보다 더 남지 않는다(K-11 폴백은 5종 전부) · 동치 여부 기록', () => {
    let equal = 0;
    let total = 0;
    for (const c of chars) for (const b of bases) for (const kinds of [['rrn', 'card'], ['card'], ['rrn'], ['account'], [], ['rrn', 'card', 'phone', 'account', 'email']]) {
      const t = c + b;
      const a = maskPii(t, { kinds: kinds as never });
      const o = v2(t, { kinds });
      total++;
      if (JSON.stringify(a) === JSON.stringify(o)) equal++;
      expect(nd(a.maskedText)).toBeLessThanOrEqual(nd(o.maskedText));
    }
    // eslint-disable-next-line no-console
    console.log(`[recheck] 사설영역 입력 + kinds: v2와 동일 ${equal}/${total} (나머지는 K-11 폴백으로 더 가림)`);
  });
});

describe('(3) kinds 선택 경로 동치', () => {
  it('kinds 5종 == 기본 호출 · 대표 입력 전부', () => {
    for (const [, t] of LEAKY) for (const mode of MODES) expect(maskPii(t, { mode, kinds: ['rrn', 'card', 'phone', 'account', 'email'] as never })).toEqual(maskPii(t, { mode }));
  });
  it('card 미포함 kinds 4조합 — v2 선택 경로와 문자·카운트 동일', () => {
    for (const [, t] of LEAKY) for (const kinds of [['rrn'], ['account'], ['phone', 'email'], []]) {
      expect(maskPii(t, { kinds: kinds as never })).toEqual(v2(t, { kinds }));
    }
  });
});

describe('(4) 성능', () => {
  const cases: Array<[string, string]> = [
    ["('[카드번호]1')x1e5", '[카드번호]1'.repeat(100_000)],
    ["('1[주민등록번호]')x1e5", '1[주민등록번호]'.repeat(100_000)],
    ["('[카드번호]')x2e5", '[카드번호]'.repeat(200_000)],
    ["'1'x1e6", '1'.repeat(1_000_000)],
    ["('4111111111111111 ')x5e4", '4111111111111111 '.repeat(50_000)],
    ["('3782 822463 10005 ')x5e4", '3782 822463 10005 '.repeat(50_000)],
    ["('900101-1234567')x7e4", '900101-1234567'.repeat(70_000)],
    ["('1234567890123456789-1234567')x4e4", '1234567890123456789-1234567'.repeat(40_000)],
  ];
  it.each(cases)('%s — 2모드+kinds 합계 3초 미만', (n, input) => {
    const t0 = Date.now();
    for (const mode of MODES) maskPii(input, { mode });
    maskPii(input, { kinds: ['rrn', 'card'] as never });
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[recheck-perf] ${n} ${ms}ms`);
    expect(ms).toBeLessThan(3000);
  }, 60_000);
});

describe('(5) 독립 퍼징 — 별도 시드 · 대괄호·사설영역 포함 알파벳 · 구 규칙(v2) 대비 숫자 노출 증가 0', () => {
  it('100,000건 x 2모드', () => {
    // xorshift32 — 기존 spec의 LCG와 다른 생성기·시드
    let s = 0x9e3779b9 | 0;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const pieces = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '1', '7', '4', '-', '-', ' ', ' ', 'a', '가', '@', '.', '\n', '[', ']', '[카드번호]', '[주민등록번호]', '', '', '',
      '900101', '1234567', '4111', '1111', '378282246310005', '2026-09-30', '생일 ', 'x@y.co'];
    let samples = 0;
    let worse = 0;
    let changed = 0;
    let worseVsInputDigits = 0;
    const examples: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      const n = 1 + Math.floor(rnd() * 20);
      let t = '';
      for (let k = 0; k < n; k++) t += pieces[Math.floor(rnd() * pieces.length)];
      for (const mode of MODES) {
        samples++;
        const a = maskPii(t, { mode });
        const b = v2(t, { mode });
        if (a.maskedText !== b.maskedText) changed++;
        if (nd(a.maskedText) > nd(b.maskedText)) {
          worse++;
          if (examples.length < 5) examples.push(JSON.stringify([t, mode, a.maskedText, b.maskedText]));
        }
        if (nd(a.maskedText) > nd(t)) worseVsInputDigits++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[recheck-fuzz] 표본=${samples} v2와 달라진 건수=${changed} 숫자를 v2보다 더 남긴 건수=${worse} 입력 숫자보다 늘어남=${worseVsInputDigits} ${examples.join(' ')}`);
    expect(worse).toBe(0);
    expect(worseVsInputDigits).toBe(0);
  }, 240_000);
});
