import { parseSitemap } from './sitemap-parse';

describe('parseSitemap', () => {
  it('urlset의 loc을 추출한다', () => {
    const xml = '<urlset><url><loc>https://a.example/1</loc></url><url><loc>https://a.example/2</loc></url></urlset>';
    const result = parseSitemap(xml);
    expect(result.kind).toBe('URLSET');
    expect(result.locs).toEqual(['https://a.example/1', 'https://a.example/2']);
  });

  it('sitemapindex를 식별한다', () => {
    const xml = '<sitemapindex><sitemap><loc>https://a.example/sitemap1.xml</loc></sitemap></sitemapindex>';
    const result = parseSitemap(xml);
    expect(result.kind).toBe('SITEMAPINDEX');
    expect(result.locs).toEqual(['https://a.example/sitemap1.xml']);
  });

  it('AC-KB6-5: DOCTYPE이 있으면 해석을 거부한다(XXE 방어)', () => {
    const xml = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><urlset><url><loc>&xxe;</loc></url></urlset>';
    const result = parseSitemap(xml);
    expect(result.kind).toBe('REJECTED');
    expect(result.locs).toEqual([]);
  });

  it('ENTITY 선언만 있어도 거부한다', () => {
    const xml = '<!ENTITY xxe "test"><urlset></urlset>';
    expect(parseSitemap(xml).kind).toBe('REJECTED');
  });

  it('둘 다 없으면 EMPTY', () => {
    expect(parseSitemap('<foo></foo>').kind).toBe('EMPTY');
  });
});
