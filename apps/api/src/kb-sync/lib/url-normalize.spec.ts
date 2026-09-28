import { isSameHostPort, normalizeUrl } from './url-normalize';

describe('normalizeUrl', () => {
  it('스킴·호스트를 소문자화하고 기본 포트를 제거한다', () => {
    expect(normalizeUrl('HTTPS://Example.com:443/Path', { allowQueryUrls: false })).toBe('https://example.com/PATH'.replace('PATH', 'Path'));
  });

  it('프래그먼트를 제거한다', () => {
    expect(normalizeUrl('https://example.com/a#section', { allowQueryUrls: false })).toBe('https://example.com/a');
  });

  it('..을 경로에서 정리한다(WHATWG URL 파서)', () => {
    expect(normalizeUrl('https://example.com/a/../b', { allowQueryUrls: false })).toBe('https://example.com/b');
  });

  it('퍼센트 인코딩을 대문자화한다', () => {
    const result = normalizeUrl('https://example.com/a%2eb', { allowQueryUrls: false });
    expect(result).toBe('https://example.com/a%2Eb');
  });

  it('쿼리가 있고 allowQueryUrls=false면 null을 반환한다', () => {
    expect(normalizeUrl('https://example.com/a?x=1', { allowQueryUrls: false })).toBeNull();
  });

  it('쿼리 매개변수를 정렬한다(allowQueryUrls=true)', () => {
    const result = normalizeUrl('https://example.com/a?b=2&a=1', { allowQueryUrls: true });
    expect(result).toBe('https://example.com/a?a=1&b=2');
  });

  it('사용자정보(@)가 있으면 거부한다', () => {
    expect(normalizeUrl('https://user:pass@example.com/', { allowQueryUrls: false })).toBeNull();
  });

  it('http·https 외 스킴은 거부한다', () => {
    expect(normalizeUrl('ftp://example.com/', { allowQueryUrls: false })).toBeNull();
  });

  it('형식이 잘못된 URL은 null이다', () => {
    expect(normalizeUrl('not a url', { allowQueryUrls: false })).toBeNull();
  });

  it('빈 경로는 "/"로 정규화된다', () => {
    expect(normalizeUrl('https://example.com', { allowQueryUrls: false })).toBe('https://example.com/');
  });
});

describe('isSameHostPort — 인증 헤더 동행 판정(pass 10 · RG-24①)', () => {
  it.each([
    ['https://a.example/docs/', 'https://a.example/x', true],
    ['https://a.example/docs/', 'https://A.Example:443/x', true], // 명시된 기본 포트·대소문자는 같은 출처
    ['http://a.example/docs/', 'https://a.example/x', true], // http → https 상향(둘 다 기본 포트)
    ['http://a.example:80/docs/', 'https://a.example:443/x', true],
    ['https://a.example/docs/', 'https://a.example:8443/x', false],
    ['https://a.example:8443/docs/', 'https://a.example/x', false],
    ['http://a.example:8080/docs/', 'https://a.example:8080/x', true],
    ['https://a.example/docs/', 'https://b.example/x', false],
    ['not a url', 'not a url', false],
  ])('%s → %s = %s', (start, hop, expected) => {
    expect(isSameHostPort(start, hop)).toBe(expected);
  });
});
