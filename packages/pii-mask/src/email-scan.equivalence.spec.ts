import { replaceEmails } from './email-scan';

/**
 * [L-6] `replaceEmails`가 구 `EMAIL_REGEX`와 결과가 같음을 차분 퍼징으로 고정한다.
 * 오라클 정규식은 **구현과 공유하지 않고** 이 파일에 리터럴로 동결한다(구 `index.ts` 정의 그대로).
 */
const OLD_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function oracle(input: string): { out: string; calls: string[] } {
  const calls: string[] = [];
  const out = input.replace(OLD_EMAIL_REGEX, (m) => {
    calls.push(m);
    return `<${m.length}>`;
  });
  return { out, calls };
}

function actual(input: string): { out: string; calls: string[] } {
  const calls: string[] = [];
  const out = replaceEmails(input, (m) => {
    calls.push(m);
    return `<${m.length}>`;
  });
  return { out, calls };
}

// 시드 고정 의사난수(mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ['a', 'Z', '0', '9', '.', '_', '%', '+', '-', '@', ' ', '가', '!'];
const PIECES = ['x@y.com', '.co.kr', '@@', 'a@b.cc', '1@z.io', 'com', '@y.'];

describe('replaceEmails — 구 정규식과 결과 동일(L-6)', () => {
  it('차분 퍼징 50,000개 — 결과 문자열과 치환 콜백에 전달된 일치 목록이 같다', () => {
    const rand = rng(20261001);
    for (let i = 0; i < 50_000; i += 1) {
      const len = Math.floor(rand() * 65);
      let s = '';
      while (s.length < len) {
        s += rand() < 0.2 ? PIECES[Math.floor(rand() * PIECES.length)] : ALPHABET[Math.floor(rand() * ALPHABET.length)];
      }
      s = s.slice(0, 64 + 8);
      const a = actual(s);
      const o = oracle(s);
      if (a.out !== o.out || a.calls.join('\u0000') !== o.calls.join('\u0000')) {
        throw new Error(`불일치 #${i} 입력=${JSON.stringify(s)} 구=${JSON.stringify(o)} 신=${JSON.stringify(a)}`);
      }
    }
  }, 60_000);

  it.each([
    'x@y.com1@z.com',
    'x@y.com.a@z.com',
    'x@y.com_b@z.com',
    'x@y.com%c@z.com',
    'x@y.com+d@z.com',
    'x@y.com-e@z.com',
    'a@b.coma@b.com',
    'x@y.co.kr2@z.io',
    '',
    '@',
    'a@b',
    'a@b.c',
    'abc def@ghi.jk lmn@opq.rs',
  ])('인접 사례 %j — 구 정규식과 같다', (input) => {
    expect(actual(input)).toEqual(oracle(input));
  });

  it('직전 일치 바로 뒤에 붙은 두 번째 이메일도 놓치지 않는다(되돌아보기만으로는 놓치는 사례)', () => {
    expect(actual('x@y.com1@z.com').calls).toEqual(['x@y.com', '1@z.com']);
  });
});
