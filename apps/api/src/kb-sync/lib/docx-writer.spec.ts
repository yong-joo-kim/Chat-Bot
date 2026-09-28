import { unzipSync } from 'fflate';
import { buildDocx } from './docx-writer';

describe('buildDocx', () => {
  it('같은 입력은 항상 같은 바이트를 만든다(결정적 — 고정 mtime)', () => {
    const input = { headerLines: ['출처: https://a.example/x', '제목: 제목', '수집 시각: 2026-01-01'], bodyText: '# 제목\n본문 문단입니다.' };
    const a = buildDocx(input);
    const b = buildDocx(input);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('fflate로 다시 풀면 4파트가 있고 XML이 깨지지 않는다', () => {
    const bytes = buildDocx({ headerLines: ['출처: https://a.example/x'], bodyText: '<script>alert(1)</script> & "quote"' });
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'].sort());
    const doc = new TextDecoder().decode(entries['word/document.xml']);
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).toContain('&amp;');
    expect(doc).toContain('&quot;quote&quot;');
    expect(doc).not.toContain('<script>');
  });

  it('제목 줄(# )은 Heading1 스타일로 변환된다', () => {
    const bytes = buildDocx({ headerLines: [], bodyText: '# 제목입니다' });
    const entries = unzipSync(bytes);
    const doc = new TextDecoder().decode(entries['word/document.xml']);
    expect(doc).toContain('Heading1');
    expect(doc).toContain('제목입니다');
  });

  it('제어 문자를 제거한다', () => {
    const bytes = buildDocx({ headerLines: [], bodyText: '본문\u0000\u0001텍스트' });
    const entries = unzipSync(bytes);
    const doc = new TextDecoder().decode(entries['word/document.xml']);
    expect(doc).toContain('본문텍스트');
  });
});
