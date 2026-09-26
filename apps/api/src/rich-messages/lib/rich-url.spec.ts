import { hostMatchesRules, inspectRichUrl, isSafeRichUrl, KNOWN_URL_SHORTENER_HOSTS, RICH_URL_MAX_LENGTH } from '@chat-bot/shared-types';

/**
 * `inspectRichUrl` 판정 표(`channel-rich-messages-설계.md` §9.1 · §18.1). 순수 함수 단위 시험 —
 * DB·Nest 무의존.
 */
describe('inspectRichUrl — 거부(reject)', () => {
  it.each([
    ['http://a.example.com/', 'NOT_HTTPS'],
    ['https:host', 'NOT_HTTPS'],
    ['ftp://a.example.com/', 'NOT_HTTPS'],
    ['javascript:alert(1)', 'NOT_HTTPS'],
    ['data:text/html,<script>', 'NOT_HTTPS'],
  ])('%s → %s', (url, expected) => {
    const r = inspectRichUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(expected);
  });

  it("https://a.example@b.example/ → USERINFO(리터럴 '@')", () => {
    const r = inspectRichUrl('https://a.example@b.example/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('USERINFO');
  });

  it('https://a%40b.example → 거부(퍼센트 인코딩 우회 — 파서가 유효한 호스트로 파싱하지 못한다)', () => {
    const r = inspectRichUrl('https://a%40b.example');
    expect(r.ok).toBe(false);
  });

  it("https://@evil.com/... → USERINFO(빈 userinfo + '@' — 파서의 username/password 검사는 통과하지만 authorityHasAt이 잡아야 한다)", () => {
    const r = inspectRichUrl('https://@evil.com/path');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('USERINFO');
  });

  it('https://b.example/p@x → 허용(경로의 @는 허용 — R-20)', () => {
    const r = inspectRichUrl('https://b.example/p@x');
    expect(r.ok).toBe(true);
  });

  it('공백·탭·역슬래시가 있으면 INVALID_CHARS', () => {
    expect(inspectRichUrl('https://a b.example/').ok).toBe(false);
    expect(inspectRichUrl('https://a\tb.example/').ok).toBe(false);
    const r = inspectRichUrl('https://a\\b.example/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('INVALID_CHARS');
  });

  it(`${RICH_URL_MAX_LENGTH}자는 허용, ${RICH_URL_MAX_LENGTH + 1}자는 TOO_LONG`, () => {
    const base = 'https://example.com/';
    const padLenOk = RICH_URL_MAX_LENGTH - base.length;
    const okUrl = base + 'a'.repeat(padLenOk);
    expect(okUrl.length).toBe(RICH_URL_MAX_LENGTH);
    expect(inspectRichUrl(okUrl).ok).toBe(true);

    const tooLong = `${okUrl}a`;
    expect(tooLong.length).toBe(RICH_URL_MAX_LENGTH + 1);
    const r = inspectRichUrl(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('TOO_LONG');
  });

});

describe('inspectRichUrl — 경고(저장 허용)', () => {
  it('HTTPS://Example.com/a.png(대문자 스킴·호스트) → 허용, 호스트는 소문자로 정규화', () => {
    const r = inspectRichUrl('HTTPS://Example.com/a.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.host).toBe('example.com');
  });

  it('xn-- 퓨니코드 호스트 → 경고 PUNYCODE(저장 허용)', () => {
    const r = inspectRichUrl('https://xn--bcher-kva.example/img.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('PUNYCODE');
  });

  it('한글 도메인(파서가 퓨니코드로 정규화) → 경고 PUNYCODE', () => {
    const r = inspectRichUrl('https://한글도메인.example/a.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('PUNYCODE');
  });

  it('IPv4 호스트 → 경고 IP_HOST', () => {
    const r = inspectRichUrl('https://127.0.0.1/img.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('IP_HOST');
  });

  it('IPv6 리터럴 호스트 → 경고 IP_HOST', () => {
    const r = inspectRichUrl('https://[::1]/img.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('IP_HOST');
  });

  it('포트가 붙은 주소는 경고 없이 허용된다', () => {
    const r = inspectRichUrl('https://example.com:8443/a.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it.each(KNOWN_URL_SHORTENER_HOSTS)('알려진 단축 URL 호스트(%s) → 경고 SHORTENER', (host) => {
    const r = inspectRichUrl(`https://${host}/abc`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('SHORTENER');
  });

  it('일반 도메인은 경고가 없다', () => {
    const r = inspectRichUrl('https://img.example.com/a.png');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe('isSafeRichUrl — 얇은 래퍼', () => {
  it('inspectRichUrl(url).ok와 같다', () => {
    expect(isSafeRichUrl('https://example.com/a.png')).toBe(true);
    expect(isSafeRichUrl('http://example.com/a.png')).toBe(false);
  });
});

describe('hostMatchesRules', () => {
  const rules = [
    { host: 'example.com', includeSubdomains: false },
    { host: 'cdn.example.net', includeSubdomains: true },
  ];

  it('정확히 일치하면 true', () => {
    expect(hostMatchesRules('example.com', rules)).toBe(true);
  });

  it('하위 도메인 포함 미설정이면 하위 도메인은 불일치', () => {
    expect(hostMatchesRules('img.example.com', rules)).toBe(false);
  });

  it('하위 도메인 포함 설정이면 하위 도메인도 일치', () => {
    expect(hostMatchesRules('a.cdn.example.net', rules)).toBe(true);
  });

  it("badexample.com은 example.com의 하위 도메인이 아니다(문자열 접두사 함정 방지)", () => {
    expect(hostMatchesRules('badexample.com', rules)).toBe(false);
  });

  it('규칙이 없으면 항상 false(호출부가 빈 목록=허용을 별도로 처리)', () => {
    expect(hostMatchesRules('example.com', [])).toBe(false);
  });

  it('대소문자 무관 비교', () => {
    expect(hostMatchesRules('EXAMPLE.COM', rules)).toBe(true);
  });
});
