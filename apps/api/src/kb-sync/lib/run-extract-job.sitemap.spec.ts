import { gzipSync } from 'node:zlib';
import { runExtractJob } from './run-extract-job';

/**
 * [pass 4 · 위반 8] 사이트맵 해제·해석은 작업 스레드(`runExtractJob`)에서 한다 — 메인 스레드(크롤러)는 바이트를 넘기기만 한다.
 * 위반·오류는 모두 "그 사이트맵 무시(`REJECTED`)"로 수렴하고 예외를 밖으로 내지 않는다.
 */
const urlset = (locs: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('runExtractJob(SITEMAP)', () => {
  it('urlset의 <loc>을 돌려준다', async () => {
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: bytes(urlset(['https://a.example/1', 'https://a.example/2'])), contentType: 'application/xml', gzipped: false });
    expect(r.ok).toBe(true);
    expect(r.sitemap).toEqual({ kind: 'URLSET', locs: ['https://a.example/1', 'https://a.example/2'] });
  });

  it('sitemapindex는 SITEMAPINDEX로 구분해 자식 사이트맵 주소를 돌려준다', async () => {
    const xml = '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap><sitemap><loc>https://a.example/s2.xml.gz</loc></sitemap></sitemapindex>';
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: bytes(xml), contentType: null, gzipped: false });
    expect(r.sitemap).toEqual({ kind: 'SITEMAPINDEX', locs: ['https://a.example/s1.xml', 'https://a.example/s2.xml.gz'] });
  });

  it('gzip(`gzipped: true`)을 풀어 해석한다', async () => {
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: new Uint8Array(gzipSync(Buffer.from(urlset(['https://a.example/gz'])))), contentType: 'application/gzip', gzipped: true });
    expect(r.sitemap?.locs).toEqual(['https://a.example/gz']);
  });

  it('확장자 힌트가 없어도 gzip 매직 바이트면 푼다', async () => {
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: new Uint8Array(gzipSync(Buffer.from(urlset(['https://a.example/magic'])))), contentType: null, gzipped: false });
    expect(r.sitemap?.locs).toEqual(['https://a.example/magic']);
  });

  it('EUC-KR 사이트맵도 문자 해석(charset)을 거친다', async () => {
    const xml = new TextEncoder().encode(urlset(['https://a.example/ascii'])); // 인코딩 선언 경로만 확인(ASCII는 어떤 charset이든 같다).
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: xml, contentType: 'application/xml; charset=euc-kr', gzipped: false });
    expect(r.sitemap?.locs).toEqual(['https://a.example/ascii']);
  });

  it('★ DOCTYPE·ENTITY가 있는 사이트맵은 거부한다(XXE 원천 차단) — 예외 없이 REJECTED', async () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE urlset [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><urlset><url><loc>&xxe;</loc></url></urlset>';
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: bytes(xxe), contentType: null, gzipped: false });
    expect(r.ok).toBe(false);
    expect(r.sitemap).toEqual({ kind: 'REJECTED', locs: [] });
    expect(r.flags).toContain('FILE_UNSAFE');
  });

  it('★ 51MB로 해제되는 gzip 폭탄은 작업 스레드 안에서 거부한다(프로세스 정상 · 예외 없음)', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(51 * 1024 * 1024, 0)));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: bomb, contentType: null, gzipped: true });
    expect(r.ok).toBe(false);
    expect(r.sitemap?.kind).toBe('REJECTED');
  });

  it('망가진 gzip은 REJECTED로 수렴한다', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from('a'.repeat(1000))));
    for (let i = 10; i < gz.length - 8; i += 1) gz[i] = 0xff;
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: gz, contentType: null, gzipped: true });
    expect(r.ok).toBe(false);
    expect(r.sitemap?.kind).toBe('REJECTED');
  });

  it('urlset도 sitemapindex도 아닌 문서는 EMPTY(오류 아님)', async () => {
    const r = await runExtractJob({ kind: 'SITEMAP', bytes: bytes('<html><body>없음</body></html>'), contentType: null, gzipped: false });
    expect(r.ok).toBe(true);
    expect(r.sitemap).toEqual({ kind: 'EMPTY', locs: [] });
  });
});
