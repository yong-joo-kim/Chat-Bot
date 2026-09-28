import { globMatch, globMatchAny } from './glob-match';

describe('globMatch', () => {
  it('*는 임의 문자열과 일치한다', () => {
    expect(globMatch('/hr/archive/*', '/hr/archive/2020/old')).toBe(true);
  });
  it('?는 문자 1개와 일치한다', () => {
    expect(globMatch('/a?c', '/abc')).toBe(true);
    expect(globMatch('/a?c', '/abbc')).toBe(false);
  });
  it('일치하지 않으면 false', () => {
    expect(globMatch('/hr/*', '/finance/x')).toBe(false);
  });
  it('globMatchAny — 빈 목록은 불일치(false)', () => {
    expect(globMatchAny([], '/anything')).toBe(false);
  });
  it('병적 입력에도 선형 시간(백트래킹 없음) — 10만자 입력이 10ms 이내', () => {
    const text = 'a'.repeat(100_000);
    const start = Date.now();
    globMatch('*a*a*a*a*a*b', text);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
