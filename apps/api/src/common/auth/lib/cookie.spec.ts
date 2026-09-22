import { buildClearCookie, buildSetCookie, parseCookieHeader, SESSION_COOKIE_NAME } from './cookie';

describe('parseCookieHeader', () => {
  it('여러 쿠키를 파싱한다', () => {
    expect(parseCookieHeader('a=1; b=2; cb_session=abc')).toEqual({ a: '1', b: '2', cb_session: 'abc' });
  });

  it('헤더가 없으면 빈 객체를 반환한다', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader(null)).toEqual({});
  });

  it('URL 인코딩된 값을 디코딩한다', () => {
    expect(parseCookieHeader('cb_session=a%2Fb')).toEqual({ cb_session: 'a/b' });
  });

  it('형식이 어긋난 항목(=이 없는 조각)은 건너뛴다', () => {
    expect(parseCookieHeader('a=1; malformed; b=2')).toEqual({ a: '1', b: '2' });
  });
});

describe('buildSetCookie / buildClearCookie', () => {
  it('HttpOnly·SameSite=Lax가 항상 포함된다(NFR-S3)', () => {
    const value = buildSetCookie('token123', { secure: false });
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain(`${SESSION_COOKIE_NAME}=token123`);
  });

  it('secure:true면 Secure 속성이 붙는다', () => {
    expect(buildSetCookie('t', { secure: true })).toContain('Secure');
    expect(buildSetCookie('t', { secure: false })).not.toContain('Secure');
  });

  it('buildClearCookie는 Max-Age=0으로 즉시 만료시킨다(FR-12-8)', () => {
    const value = buildClearCookie(false);
    expect(value).toContain('Max-Age=0');
  });
});
