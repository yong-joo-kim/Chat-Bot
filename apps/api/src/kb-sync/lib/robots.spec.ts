import { parseRobots, robotsFetchOutcome } from './robots';

describe('parseRobots', () => {
  it('그룹 선택 — 우리 UA 토큰 그룹이 있으면 그것을 쓴다', () => {
    const text = ['User-agent: *', 'Disallow: /private/', '', 'User-agent: ChatBotKBCrawler', 'Disallow: /', 'Allow: /public/'].join('\n');
    const rules = parseRobots(text, 'ChatBotKBCrawler');
    expect(rules.isAllowed('/public/x')).toBe(true);
    expect(rules.isAllowed('/other')).toBe(false);
  });

  it('우리 UA 그룹이 없으면 * 그룹을 쓴다', () => {
    const text = ['User-agent: *', 'Disallow: /private/'].join('\n');
    const rules = parseRobots(text, 'ChatBotKBCrawler');
    expect(rules.isAllowed('/private/x')).toBe(false);
    expect(rules.isAllowed('/public/x')).toBe(true);
  });

  it('최장 일치 — 같은 길이면 Allow 우선', () => {
    const text = ['User-agent: *', 'Disallow: /a/', 'Allow: /a/'].join('\n');
    const rules = parseRobots(text, 'ChatBotKBCrawler');
    expect(rules.isAllowed('/a/')).toBe(true);
  });

  it('*·$ 지원', () => {
    const text = ['User-agent: *', 'Disallow: /*.pdf$'].join('\n');
    const rules = parseRobots(text, 'ChatBotKBCrawler');
    expect(rules.isAllowed('/a.pdf')).toBe(false);
    expect(rules.isAllowed('/a.pdfx')).toBe(true);
  });

  it('Crawl-delay를 초 단위로 읽는다', () => {
    const text = ['User-agent: *', 'Crawl-delay: 5'].join('\n');
    const rules = parseRobots(text, 'ChatBotKBCrawler');
    expect(rules.crawlDelaySec).toBe(5);
  });

  it('규칙이 없으면 기본 허용', () => {
    const rules = parseRobots('', 'ChatBotKBCrawler');
    expect(rules.isAllowed('/anything')).toBe(true);
  });
});

describe('robotsFetchOutcome', () => {
  it('4xx는 전부 허용', () => {
    expect(robotsFetchOutcome(404)).toBe('ALLOW_ALL');
  });
  it('2xx는 파싱', () => {
    expect(robotsFetchOutcome(200)).toBe('PARSE');
  });
  it('5xx·연결 실패는 그 실행에서 호스트 중단', () => {
    expect(robotsFetchOutcome(500)).toBe('ABORT_HOST');
    expect(robotsFetchOutcome(null)).toBe('ABORT_HOST');
  });
});

describe('robots — pass 6 M-3 · 429는 서버 오류(허용 아님)', () => {
  it('429는 그 호스트 수집 중단(허용으로 취급하지 않는다)', () => {
    expect(robotsFetchOutcome(429)).toBe('ABORT_HOST');
  });
  it('그 밖의 4xx는 여전히 전부 허용', () => {
    expect(robotsFetchOutcome(403)).toBe('ALLOW_ALL');
    expect(robotsFetchOutcome(410)).toBe('ALLOW_ALL');
  });
});

describe('robots — pass 6 M-4 · 한글(비ASCII) 경로와 쿼리 문자열 (RFC 9309 §2.2.2)', () => {
  const rules = (body: string) => parseRobots(body, 'ChatBotKBCrawler');
  // `new URL('https://a/관리').pathname` = '/%EA%B4%80%EB%A6%AC' — 규칙은 원문(한글)이라 같은 형태로 맞춰 비교해야 한다.
  const enc = (p: string) => new URL(`https://a.example${p}`).pathname;

  it('★ Disallow에 한글 원문으로 적어도 퍼센트 인코딩된 경로(URL 파서 결과)를 막는다', () => {
    const r = rules('User-agent: *\nDisallow: /관리\n');
    expect(r.isAllowed(enc('/관리/목록'))).toBe(false);
    expect(r.isAllowed(enc('/공지'))).toBe(true);
  });

  it('Disallow에 퍼센트 인코딩(소문자 16진)으로 적어도 같은 경로를 막는다', () => {
    const r = rules('User-agent: *\nDisallow: /%ea%b4%80%eb%a6%ac\n');
    expect(r.isAllowed(enc('/관리/목록'))).toBe(false);
  });

  it('Allow/Disallow 최장 일치도 한글 경로에서 동작한다', () => {
    const r = rules('User-agent: *\nDisallow: /규정\nAllow: /규정/공개\n');
    expect(r.isAllowed(enc('/규정/비공개'))).toBe(false);
    expect(r.isAllowed(enc('/규정/공개/안내'))).toBe(true);
  });

  it('★ 쿼리 문자열도 매칭 대상이다(Disallow: /*?sid=)', () => {
    const r = rules('User-agent: *\nDisallow: /*?sid=\n');
    expect(r.isAllowed('/page?sid=abc')).toBe(false);
    expect(r.isAllowed('/page?other=1&sid=abc')).toBe(true); // 접두는 `?sid=`로 시작해야 한다.
    expect(r.isAllowed('/page')).toBe(true);
  });

  it('한글 쿼리 값도 같은 형태로 비교한다', () => {
    const r = rules('User-agent: *\nDisallow: /*?이름=\n');
    expect(r.isAllowed(`/p?${new URLSearchParams({ 이름: '값' }).toString()}`)).toBe(false);
  });
});
