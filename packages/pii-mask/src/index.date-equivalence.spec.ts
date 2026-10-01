import { maskPii, type PiiKind } from './index';

/**
 * [L-5] 기본 경로 ≡ 선택 경로(kinds 5종) 동등성 — 시드 고정 의사난수 5,000개 × 2모드.
 * 기본 경로(계좌 치환 콜백)와 선택 경로(날짜 자리표시 단계)가 같은 판정 함수 1벌을 쓴다는 설계(§5.5-3)를 증명한다.
 */
const ALL: PiiKind[] = ['rrn', 'card', 'phone', 'account', 'email'];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = ['0', '1', '2', '9', '-', '-', ' ', '\u3000', '가', '발', 'a', '@', '.', ':', '(', '[', ')', ']', '/', '~', '\n', '"', ',', '\u2010', '\u2013', '\u2014', '\u2212', '\u301C', '\u201C', '\u201D', '\u2018', '\u2019', '\u300C', '\u300D', '\u300E', '\u300F', '\u200B', '\uFEFF'];
const KEYWORDS = ['생년', '생일', '출생', '탄생일', 'birth', 'DOB', '생년월일', 'Birthday', 'birth date', 'Birth  Date', '(양력)', '[음력]', '\uFF08양력\uFF09'];
const DATES = ['1990-05-12', '2026-09-30', '2000-01-01', '2026-13-01', '1999-12-31', '12026-09-30', '26-09-30'];
const OTHERS = ['010-1234-5678', '901231-1234567', '1234 5678 9012 3456', '110-234-567890', 'abcd@example.com'];

function randomText(rand: () => number): string {
  const parts = 1 + Math.floor(rand() * 8);
  let out = '';
  for (let i = 0; i < parts; i += 1) {
    const r = rand();
    if (r < 0.25) out += KEYWORDS[Math.floor(rand() * KEYWORDS.length)];
    else if (r < 0.5) out += DATES[Math.floor(rand() * DATES.length)];
    else if (r < 0.6) out += OTHERS[Math.floor(rand() * OTHERS.length)];
    else {
      const n = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k += 1) out += CHARS[Math.floor(rand() * CHARS.length)];
    }
  }
  return out;
}

describe('maskPii — 기본 경로 ≡ 선택 경로(5종) 퍼징(L-5)', () => {
  it.each(['PARTIAL', 'FULL'] as const)('%s: 5,000개 무작위 문자열에서 결과가 같다', (mode) => {
    const rand = mulberry32(20261001);
    for (let i = 0; i < 5000; i += 1) {
      const s = randomText(rand);
      expect({ s, r: maskPii(s, { mode }) }).toEqual({ s, r: maskPii(s, { mode, kinds: ALL }) });
    }
  });
});
