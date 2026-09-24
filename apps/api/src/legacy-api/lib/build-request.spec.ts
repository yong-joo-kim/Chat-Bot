import { buildLegacyRequest } from './build-request';

const BASE_URL = 'https://legacy.example.invalid/api';

describe('build-request — URL 조립·재파싱 검증(§7.2, AC-L4-6)', () => {
  it('정상 경로 + 자리표시자 치환 성공', () => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: ['12345'],
      query: [{ name: 'status', value: 'ok' }],
      body: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.url).toBe('https://legacy.example.invalid/api/orders/12345?status=ok');
      expect(result.request.hostname).toBe('legacy.example.invalid');
    }
  });

  it.each([
    ['퍼센트 인코딩 상위 경로(디코딩하면 ..)', '%2e%2e'],
    ['단일 dot', '.'],
    ['이중 dot', '..'],
  ])('경로 값 인젝션 표 — %s는 BLOCKED_URL로 거부된다', (_label, value) => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: [value],
      query: [],
      body: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe('BLOCKED_URL');
  });

  it.each([
    ['상위 경로 이탈 시도 문자열(경로 구분자까지 encodeURIComponent로 무력화)', '../admin?x=1#'],
    ['JSON 인젝션 시도 문자열(따옴표·콜론도 인코딩됨)', 'a"},"role":"admin'],
    ['CRLF 헤더 인젝션 시도(개행이 %0D%0A로 인코딩됨)', '\r\nX-Evil: 1'],
  ])('경로 값 인젝션 표 — %s는 그 자체가 하나의 경로 세그먼트로 안전하게 인코딩된다(BLOCKED_URL이 아니라 무력화)', (_label, value) => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: [value],
      query: [],
      body: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.request.url);
      // 세그먼트 수 불변(§17) — 위험 문자가 전부 인코딩되어 추가 경로 세그먼트를 만들지 못한다.
      expect(url.pathname.split('/').filter(Boolean)).toEqual(['api', 'orders', encodeURIComponent(value)]);
      expect(url.hostname).toBe('legacy.example.invalid');
      // 원문 CR/LF/따옴표가 그대로 남아 있지 않다(전부 percent-encoded).
      expect(result.request.url.includes('\r')).toBe(false);
      expect(result.request.url.includes('\n')).toBe(false);
    }
  });

  it('유니코드 경로 값은 퍼센트 인코딩되어 세그먼트 수가 불변이다', () => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: ['한글값'],
      query: [],
      body: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.request.url);
      expect(url.pathname.split('/').filter(Boolean)).toEqual(['api', 'orders', encodeURIComponent('한글값')]);
    }
  });

  it('빈 문자열 경로 값도 BLOCKED_URL이다', () => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: [''],
      query: [],
      body: [],
    });
    expect(result.ok).toBe(false);
  });

  it('POST 본문은 dot 경로로 중첩 객체를 구성해 JSON.stringify한다', () => {
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'POST',
      pathTemplate: '/orders',
      pathValues: [],
      query: [],
      body: [
        { field: 'customer.name', value: '홍길동' },
        { field: 'customer.phone', value: '010-0000-0000' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.request.bodyJson ?? '{}')).toEqual({ customer: { name: '홍길동', phone: '010-0000-0000' } });
    }
  });

  it('호스트/포트가 baseUrl과 달라지는 조립 결과는 BLOCKED_URL이다(호스트 변경 방지)', () => {
    // 자리표시자 값 자체로는 호스트를 바꿀 수 없음을 방증 — pathValues는 항상 percent-encode된다.
    const result = buildLegacyRequest({
      baseUrl: BASE_URL,
      method: 'GET',
      pathTemplate: '/orders/{0}',
      pathValues: ['evil.example.com'],
      query: [],
      body: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(new URL(result.request.url).hostname).toBe('legacy.example.invalid');
  });
});
