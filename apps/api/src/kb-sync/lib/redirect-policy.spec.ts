import { resolveRedirect, shouldStopRedirect, MAX_REDIRECT_HOPS } from './redirect-policy';

describe('resolveRedirect', () => {
  it('상대 경로 Location을 현재 URL 기준으로 해석한다', () => {
    const result = resolveRedirect('https://a.example/x/', '../y');
    expect(result).toEqual({ ok: true, url: 'https://a.example/y' });
  });

  it('Location이 없으면 거부', () => {
    expect(resolveRedirect('https://a.example/', undefined)).toEqual({ ok: false, reason: 'NO_LOCATION' });
  });

  it('https → http 하향은 거부', () => {
    const result = resolveRedirect('https://a.example/', 'http://a.example/x');
    expect(result).toEqual({ ok: false, reason: 'SCHEME_DOWNGRADE' });
  });

  it('http → https 상향은 허용', () => {
    const result = resolveRedirect('http://a.example/', 'https://a.example/x');
    expect(result.ok).toBe(true);
  });
});

describe('shouldStopRedirect', () => {
  it('최대 3회를 넘으면 중단', () => {
    expect(shouldStopRedirect(MAX_REDIRECT_HOPS, new Set(), 'https://a.example/next')).toBe(true);
    expect(shouldStopRedirect(MAX_REDIRECT_HOPS - 1, new Set(), 'https://a.example/next')).toBe(false);
  });
  it('이미 방문한 URL로 돌아오면(순환) 중단', () => {
    expect(shouldStopRedirect(0, new Set(['https://a.example/next']), 'https://a.example/next')).toBe(true);
  });
});
