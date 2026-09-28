import { canSendAuthTo, computeAllowedOrigins, computePlainHttpOrigins, isAllowedOrigin } from './allowed-origins';

/** 시험용 — 허용 출처 · 평문 http 출처를 함께 든 값. */
const o = (allowedOrigins: string[], plainHttpOrigins: string[] = []) => ({ allowedOrigins, plainHttpOrigins });

describe('computeAllowedOrigins — 시작 주소·사이트맵에서 host:port 집합을 계산한다(pass 12 · RG-26)', () => {
  it('포트가 없으면 기본 포트(포트 없는 host)만 — 다른 포트는 들어가지 않는다', () => {
    expect(computeAllowedOrigins(['https://a.example/docs/'], [])).toEqual(['a.example']);
  });

  it('명시된 포트는 그대로 들어간다 · 여러 포트를 명시하면 모두 허용한다', () => {
    expect(computeAllowedOrigins(['https://a.example:8443/', 'https://a.example/'], ['https://a.example:9000/sitemap.xml']).sort()).toEqual(['a.example', 'a.example:8443', 'a.example:9000']);
  });

  it('기본 포트 표기 차이(:443 · :80 명시 vs 생략)는 같은 출처다 · 대소문자는 무시한다', () => {
    expect(computeAllowedOrigins(['https://A.Example:443/', 'https://a.example/'], ['http://a.example:80/s.xml'])).toEqual(['a.example']);
  });

  it('http↔https 상향은 같은 출처(기본 포트끼리)다', () => {
    expect(computeAllowedOrigins(['http://a.example/'], [])).toEqual(computeAllowedOrigins(['https://a.example/'], []));
  });

  it('http에 :443처럼 스킴 기본이 아닌 포트는 명시된 포트다', () => {
    expect(computeAllowedOrigins(['http://a.example:443/'], [])).toEqual(['a.example:443']);
  });

  it('해석할 수 없는 값은 건너뛴다 · 입력이 없으면 빈 집합', () => {
    expect(computeAllowedOrigins(['not a url'], [])).toEqual([]);
    expect(computeAllowedOrigins([], [])).toEqual([]);
  });
});

describe('isAllowedOrigin / canSendAuthTo', () => {
  const origins = ['a.example', 'a.example:8443'];

  it.each([
    ['https://a.example/x', true],
    ['https://a.example:443/x', true],
    ['http://a.example/x', true],
    ['https://a.example:8443/x', true],
    ['https://a.example:9443/x', false],
    ['https://A.EXAMPLE:8443/x', true],
    ['https://b.example/x', false],
    ['not a url', false],
  ])('isAllowedOrigin(%s) = %s', (url, expected) => {
    expect(isAllowedOrigin(origins, url)).toBe(expected);
  });

  it('빈 집합은 아무것도 허용하지 않는다', () => {
    expect(isAllowedOrigin([], 'https://a.example/')).toBe(false);
  });

  it('첫 요청(startUrl 생략) — 허용 출처와 정확히 일치할 때만 헤더를 싣는다', () => {
    expect(canSendAuthTo(o(['a.example']), 'https://a.example/x')).toBe(true);
    expect(canSendAuthTo(o(['a.example']), 'https://a.example:8443/x')).toBe(false);
    expect(canSendAuthTo(o(['a.example', 'a.example:8443']), 'https://a.example:8443/x')).toBe(true);
  });

  it('홉(startUrl 있음) — 허용 출처여도 시작 URL과 host:port가 다르면 싣지 않는다(RG-24①)', () => {
    expect(canSendAuthTo(o(origins), 'https://a.example:8443/y', 'https://a.example/x')).toBe(false);
    expect(canSendAuthTo(o(origins), 'https://a.example/y', 'https://a.example/x')).toBe(true);
    expect(canSendAuthTo(o(origins, ['a.example']), 'https://a.example/y', 'http://a.example/x')).toBe(true); // http→https 상향(기본 포트끼리)
    expect(canSendAuthTo(o(origins), 'https://a.example/y', 'http://a.example/x')).toBe(true); // 상향은 평문 출처 명시와 무관하게 유지
  });
});

describe('computePlainHttpOrigins — http:를 명시한 시작 주소·사이트맵의 host:port(pass 13 · RG-28)', () => {
  it('https만 명시한 출처는 들어가지 않는다 — 허용 출처(범위)는 그대로 스킴을 보지 않는다', () => {
    expect(computePlainHttpOrigins(['https://a.example/docs/'], [])).toEqual([]);
    expect(computeAllowedOrigins(['https://a.example/docs/'], [])).toEqual(['a.example']);
  });

  it('http 시작 주소 · http 사이트맵이 각각 출처를 만든다 · 포트는 그대로', () => {
    expect(computePlainHttpOrigins(['http://a.example/docs/'], [])).toEqual(['a.example']);
    expect(computePlainHttpOrigins(['https://a.example/'], ['http://a.example/sitemap.xml'])).toEqual(['a.example']);
    expect(computePlainHttpOrigins(['http://a.example:8080/', 'https://b.example/'], ['http://c.example:81/s.xml']).sort()).toEqual(['a.example:8080', 'c.example:81']);
  });

  it('기본 포트 표기 차이(http :80 명시 vs 생략)는 같은 출처 · 해석 불가는 건너뛴다', () => {
    expect(computePlainHttpOrigins(['http://A.example:80/', 'http://a.example/'], [])).toEqual(['a.example']);
    expect(computePlainHttpOrigins(['not a url'], [])).toEqual([]);
  });
});

describe('canSendAuthTo — 평문 http 요청은 http:를 명시한 출처에만(pass 13 · RG-28)', () => {
  const httpsOnly = o(['a.example']); // 시작 주소 https://a.example/ 만

  it('★ https 시작 주소만 있는 소스 — 같은 호스트의 http: URL(첫 요청)에는 헤더를 싣지 않는다', () => {
    expect(canSendAuthTo(httpsOnly, 'http://a.example/x')).toBe(false);
    expect(canSendAuthTo(httpsOnly, 'https://a.example/x')).toBe(true); // 대조 — https는 그대로
    expect(isAllowedOrigin(httpsOnly.allowedOrigins, 'http://a.example/x')).toBe(true); // 범위 판정은 바꾸지 않았다
  });

  it('★ 시작 주소·사이트맵이 http:를 명시한 출처의 http: 요청에는 싣는다(http 시작 주소 소스 · https 시작 + http 사이트맵)', () => {
    expect(canSendAuthTo(o(['a.example'], ['a.example']), 'http://a.example/x')).toBe(true);
    expect(canSendAuthTo(o(['a.example'], ['a.example']), 'https://a.example/x')).toBe(true);
  });

  it('http: 명시는 그 host:port 한정 — 다른 포트·다른 호스트의 http: URL에는 싣지 않는다', () => {
    const cfg = o(['a.example', 'a.example:8080', 'b.example'], ['a.example:8080']);
    expect(canSendAuthTo(cfg, 'http://a.example:8080/x')).toBe(true);
    expect(canSendAuthTo(cfg, 'http://a.example/x')).toBe(false);
    expect(canSendAuthTo(cfg, 'http://b.example/x')).toBe(false);
  });

  it('홉 — http 시작 문서가 http로 이어지면 싣고, https 시작 문서가 http로 하향하면 평문 출처가 명시돼도 싣지 않는다(이중 방어)', () => {
    expect(canSendAuthTo(o(['a.example'], ['a.example']), 'http://a.example/y', 'http://a.example/x')).toBe(true);
    expect(canSendAuthTo(o(['a.example'], ['a.example']), 'http://a.example/y', 'https://a.example/x')).toBe(false);
    expect(canSendAuthTo(httpsOnly, 'http://a.example/y', 'http://a.example/x')).toBe(false); // 시작이 http:여도 평문 출처가 명시되지 않았으면(링크로 발견한 http 문서) 싣지 않는다
  });

  it('(e) 기본 포트 표기 차이는 같은 출처 — https://a:443 명시 · 생략, http://a:80 명시 · 생략', () => {
    const cfg = o(computeAllowedOrigins(['https://a.example:443/', 'http://a.example:80/'], []), computePlainHttpOrigins(['https://a.example:443/', 'http://a.example:80/'], []));
    expect(canSendAuthTo(cfg, 'https://a.example/x')).toBe(true);
    expect(canSendAuthTo(cfg, 'https://a.example:443/x')).toBe(true);
    expect(canSendAuthTo(cfg, 'http://a.example/x')).toBe(true);
    expect(canSendAuthTo(cfg, 'http://a.example:80/x')).toBe(true);
    const httpsExplicit = o(computeAllowedOrigins(['https://a.example:443/'], []), computePlainHttpOrigins(['https://a.example:443/'], []));
    expect(canSendAuthTo(httpsExplicit, 'https://a.example/x')).toBe(true);
    expect(canSendAuthTo(httpsExplicit, 'http://a.example:80/x')).toBe(false);
  });
});
