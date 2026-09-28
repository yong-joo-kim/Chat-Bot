import { httpOrHttpsScheme } from './url-scheme';

describe('httpOrHttpsScheme — R1 리뷰 L-2', () => {
  it('http:// 문서는 http: 스킴을 돌려준다(사내 http-only 사이트 지원)', () => {
    expect(httpOrHttpsScheme('http://intra.example.invalid/hr/')).toBe('http:');
  });
  it('https:// 문서는 https: 스킴을 돌려준다', () => {
    expect(httpOrHttpsScheme('https://intra.example.invalid/hr/')).toBe('https:');
  });
  it('파싱할 수 없는 값은 방어적으로 https:로 대체한다', () => {
    expect(httpOrHttpsScheme('not a url')).toBe('https:');
  });
});
