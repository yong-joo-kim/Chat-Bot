import { extractHtml } from './html-extract';

describe('extractHtml', () => {
  it('script·style·nav·footer는 제거한다', () => {
    const html = '<html><body><nav>메뉴</nav><script>alert(1)</script><style>.a{}</style><p>본문</p><footer>바닥글</footer></body></html>';
    const result = extractHtml(html);
    expect(result.text).toContain('본문');
    expect(result.text).not.toContain('메뉴');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('바닥글');
  });

  it('<main>이 있으면 그 안만 추출한다', () => {
    const html = '<html><body><header>헤더텍스트</header><main><p>본문영역</p></main></body></html>';
    const result = extractHtml(html);
    expect(result.text).toContain('본문영역');
    expect(result.text).not.toContain('헤더텍스트');
  });

  it('제목은 <title>에서 가져온다', () => {
    const html = '<html><head><title>페이지 제목</title></head><body><p>내용</p></body></html>';
    expect(extractHtml(html).title).toBe('페이지 제목');
  });

  it('noindex·nofollow 메타를 인식한다', () => {
    const html = '<html><head><meta name="robots" content="noindex, nofollow"></head><body><p>x</p></body></html>';
    const result = extractHtml(html);
    expect(result.noindex).toBe(true);
    expect(result.nofollow).toBe(true);
  });

  it('canonical 링크를 인식한다', () => {
    const html = '<html><head><link rel="canonical" href="https://a.example/canonical"></head><body></body></html>';
    expect(extractHtml(html).canonical).toBe('https://a.example/canonical');
  });

  it('a 태그의 href를 링크로 수집한다', () => {
    const html = '<body><a href="/a">A</a><a href="/b">B</a></body>';
    expect(extractHtml(html).links).toEqual(['/a', '/b']);
  });

  it('h1은 제목 표식(# )을 단다', () => {
    const html = '<body><h1>큰제목</h1><p>본문</p></body>';
    expect(extractHtml(html).text).toContain('# 큰제목');
  });
});
