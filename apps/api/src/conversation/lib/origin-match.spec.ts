import { isOriginAllowed, normalizeOrigin } from './origin-match';

describe('normalizeOrigin / isOriginAllowed — §8.7', () => {
  it('기본 포트(443)는 제거되고 대소문자는 무시된다', () => {
    expect(normalizeOrigin('HTTPS://Example.com:443')).toBe('https://example.com');
  });

  it('후행 슬래시는 제거된다', () => {
    expect(normalizeOrigin('https://example.com/')).toBe('https://example.com');
  });

  it('allowedOrigins가 비어 있으면 전부 허용한다(FR-11-9)', () => {
    expect(isOriginAllowed('https://anything.com', [])).toBe(true);
  });

  it('Origin 헤더가 없으면 통과한다(서버 간 호출)', () => {
    expect(isOriginAllowed(undefined, ['https://example.com'])).toBe(true);
  });

  it('허용 목록에 있으면 통과한다', () => {
    expect(isOriginAllowed('https://www.example.co.kr', ['https://www.example.co.kr'])).toBe(true);
  });

  it('허용 목록에 없으면 차단된다', () => {
    expect(isOriginAllowed('https://evil.example', ['https://www.example.co.kr'])).toBe(false);
  });

  it('서브도메인 와일드카드는 지원하지 않는다(EX-11-4)', () => {
    expect(isOriginAllowed('https://sub.example.com', ['https://example.com'])).toBe(false);
  });
});
