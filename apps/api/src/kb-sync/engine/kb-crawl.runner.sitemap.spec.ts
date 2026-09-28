import { gzipSync } from 'node:zlib';
import type { ConfigService } from '@nestjs/config';
import { KbCrawlRunner } from './kb-crawl.runner';
import { InProcessExtractor } from '../extract/in-process.extractor';
import { WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort, KbExtractRequest } from '../extract/kb-extractor.port';

/**
 * [pass 4 · 위반 8 + 사이트맵 색인] 크롤러(메인 스레드)는 사이트맵을 **직접 해제·파싱하지 않고** 추출기 포트(작업 스레드)에
 * 바이트를 넘긴다. `<sitemapindex>`는 1단계만 따라간다(자식 안의 색인은 무시 · 파일 ≤ 50개 · 파일당 압축 10MB).
 * `ensureSeeded()`(프런티어 씨앗 넣기)만 떼어 확인한다 — 외부 호출은 가짜 fetcher·저장소로 대체한다.
 */
const HOST = 'https://a.example';
const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
const index = (locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;
const ok = (body: string | Buffer, contentType = 'application/xml') => ({ kind: 'RESPONSE' as const, status: 200, contentType, body: Buffer.from(body), headers: {} });

const source = {
  id: 'src-1',
  name: 's',
  seedUrls: [`${HOST}/docs/start`],
  sitemapUrls: [`${HOST}/sitemap.xml`],
  allowedHosts: ['a.example'],
  allowedOrigins: ['a.example'],
  plainHttpOrigins: [],
  pathPrefixes: ['/docs'],
  excludePatterns: [],
  noisePatterns: [],
  allowQueryUrls: false,
  maxDepth: 3,
  maxPages: 500,
  fileTypes: [],
  maxFileBytes: 20 * 1024 * 1024,
  minIntervalMs: 500,
  authKind: 'NONE',
  authHeaderName: null,
  authSecretRef: null,
  piiMask: true,
};
const run = { id: 'run-1', sourceId: 'src-1', kind: 'PREVIEW' as const };

function setup(pages: Record<string, ReturnType<typeof ok>>, extractor: KbExtractorPort = new InProcessExtractor(), maxPages = 500) {
  const seedFrontier = jest.fn().mockResolvedValue(0);
  const store = { countFrontier: jest.fn().mockResolvedValue({ visited: 0, queued: 0, total: 0 }), seedFrontier } as never;
  const fetchOnce = jest.fn(async ({ url }: { url: string; maxBytes: number }) => pages[url] ?? { kind: 'RESPONSE' as const, status: 404, body: Buffer.alloc(0), headers: {} });
  const config = { get: () => undefined } as unknown as ConfigService;
  const runner = new KbCrawlRunner(store, {} as never, { fetchOnce } as never, {} as never, {} as never, config, extractor);
  const seed = () => (runner as unknown as { ensureSeeded(r: typeof run, s: typeof source): Promise<void> }).ensureSeeded(run, { ...source, maxPages });
  const seeded = (): string[] => (seedFrontier.mock.calls[0]?.[2] as Array<{ url: string }> | undefined)?.map((e) => e.url) ?? [];
  return { seed, seeded, fetchOnce };
}

describe('KbCrawlRunner.ensureSeeded — 사이트맵은 추출기 포트(작업 스레드)로 해석한다', () => {
  it('★ 사이트맵 바이트를 그대로 넘기지 않고 복사본으로 SITEMAP 요청을 만든다(메인 스레드는 해제·파싱 0)', async () => {
    const calls: KbExtractRequest[] = [];
    const spy: KbExtractorPort = {
      async extract(req) {
        calls.push(req);
        return new InProcessExtractor().extract(req);
      },
    };
    const body = ok(urlset([`${HOST}/docs/a`]));
    const { seed, seeded } = setup({ [`${HOST}/sitemap.xml`]: body }, spy);
    await seed();

    expect(calls).toHaveLength(1);
    const req = calls[0];
    if (req.kind !== 'SITEMAP') throw new Error('SITEMAP 요청이어야 한다');
    expect(req.gzipped).toBe(false);
    expect(req.contentType).toBe('application/xml');
    expect(req.bytes.constructor).toBe(Uint8Array); // Buffer(공유 풀)가 아니라 복사본 — transfer해도 풀이 분리되지 않는다.
    expect(req.bytes.buffer).not.toBe(body.body.buffer);
    expect(seeded()).toEqual(expect.arrayContaining([`${HOST}/docs/a`, `${HOST}/docs/start`]));
  });

  it('★ 크롤러가 파싱하지 않는다는 증거 — 추출기가 돌려준 결과만 씨앗이 된다(본문이 XML이 아니어도)', async () => {
    const fake: KbExtractorPort = { extract: jest.fn(async () => ({ ok: true, normalizedText: '', text: '', piiMaskedCount: 0, flags: [], sitemap: { kind: 'URLSET' as const, locs: [`${HOST}/docs/from-worker`] } })) };
    const { seed, seeded } = setup({ [`${HOST}/sitemap.xml`]: ok('이건 XML이 아니다') }, fake);
    await seed();
    expect(seeded()).toContain(`${HOST}/docs/from-worker`);
  });

  it('★ <sitemapindex>는 1단계만 — 자식 사이트맵(.xml·.xml.gz)의 URL을 모으고, 색인 주소 자체는 페이지로 넣지 않는다', async () => {
    const pages = {
      [`${HOST}/sitemap.xml`]: ok(index([`${HOST}/sm/1.xml`, `${HOST}/sm/2.xml.gz`])),
      [`${HOST}/sm/1.xml`]: ok(urlset([`${HOST}/docs/one`])),
      [`${HOST}/sm/2.xml.gz`]: ok(gzipSync(Buffer.from(urlset([`${HOST}/docs/two`]))), 'application/gzip'),
    };
    const { seed, seeded } = setup(pages);
    await seed();
    const urls = seeded();
    expect(urls).toEqual(expect.arrayContaining([`${HOST}/docs/one`, `${HOST}/docs/two`]));
    expect(urls.some((u) => u.includes('/sm/'))).toBe(false); // 자식 사이트맵 파일 주소를 페이지로 넣지 않았다.
    expect(urls.some((u) => u.endsWith('/sitemap.xml'))).toBe(false);
  });

  it('★ 자식 안의 색인(색인 안의 색인)은 무시한다 — 그 자식은 가져오지 않는다', async () => {
    const pages = {
      [`${HOST}/sitemap.xml`]: ok(index([`${HOST}/sm/nested.xml`])),
      [`${HOST}/sm/nested.xml`]: ok(index([`${HOST}/sm/deep.xml`])),
      [`${HOST}/sm/deep.xml`]: ok(urlset([`${HOST}/docs/deep`])),
    };
    const { seed, seeded, fetchOnce } = setup(pages);
    await seed();
    expect(seeded()).not.toContain(`${HOST}/docs/deep`);
    expect(fetchOnce.mock.calls.map((c) => c[0].url)).not.toContain(`${HOST}/sm/deep.xml`);
  });

  it('★ 사이트맵 파일은 색인의 자식까지 합쳐 실행당 50개까지만 읽는다', async () => {
    const children = Array.from({ length: 60 }, (_, i) => `${HOST}/sm/${i}.xml`);
    const pages: Record<string, ReturnType<typeof ok>> = { [`${HOST}/sitemap.xml`]: ok(index(children)) };
    for (const [i, c] of children.entries()) pages[c] = ok(urlset([`${HOST}/docs/p${i}`]));
    const { seed, fetchOnce } = setup(pages);
    await seed();
    const sitemapFetches = fetchOnce.mock.calls.map((c) => c[0].url).filter((u) => u.includes('sitemap.xml') || u.includes('/sm/'));
    expect(sitemapFetches).toHaveLength(50); // 색인 1 + 자식 49.
  });

  it('사이트맵 응답은 압축 10MB 상한(maxBytes)으로 받는다(파일 상한 20MB가 아니다)', async () => {
    const { seed, fetchOnce } = setup({ [`${HOST}/sitemap.xml`]: ok(urlset([])) });
    await seed();
    const call = fetchOnce.mock.calls.find((c) => c[0].url === `${HOST}/sitemap.xml`)!;
    expect(call[0].maxBytes).toBe(10 * 1024 * 1024);
  });

  it('DOCTYPE(XXE)가 있는 사이트맵은 무시하고 시작 주소만으로 진행한다 · 404 사이트맵도 무시한다', async () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE u [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset><url><loc>' + HOST + '/docs/xxe</loc></url></urlset>';
    const { seed, seeded } = setup({ [`${HOST}/sitemap.xml`]: ok(xxe) });
    await seed();
    expect(seeded()).toEqual([`${HOST}/docs/start`]);

    const second = setup({}); // 사이트맵이 404
    await second.seed();
    expect(second.seeded()).toEqual([`${HOST}/docs/start`]);
  });

  it('범위 밖(호스트·경로) 사이트맵 URL은 씨앗이 되지 않고, maxPages까지만 넣는다', async () => {
    const locs = [`${HOST}/docs/in1`, `${HOST}/other/out`, 'https://evil.example/docs/x', `${HOST}/docs/in2`, `${HOST}/docs/in3`];
    const { seed, seeded } = setup({ [`${HOST}/sitemap.xml`]: ok(urlset(locs)) }, undefined, 3);
    await seed();
    const urls = seeded();
    expect(urls).toHaveLength(3);
    expect(urls).not.toContain(`${HOST}/other/out`);
    expect(urls).not.toContain('https://evil.example/docs/x');
  });

  it('워커 진입점이 없는 전역 설정 오류는 "사이트맵 무시"로 삼키지 않고 올린다(문서 탓으로 위장 금지)', async () => {
    const broken: KbExtractorPort = {
      extract: jest.fn(async () => {
        throw new WorkerEntryMissingError('없음');
      }),
    };
    const { seed } = setup({ [`${HOST}/sitemap.xml`]: ok(urlset([`${HOST}/docs/a`])) }, broken);
    await expect(seed()).rejects.toBeInstanceOf(WorkerEntryMissingError);
  });

  it('그 밖의 추출 예외(작업 스레드 시간 초과 등)는 그 사이트맵만 무시한다', async () => {
    const flaky: KbExtractorPort = {
      extract: jest.fn(async () => {
        throw new Error('FILE_UNSAFE_TIMEOUT');
      }),
    };
    const { seed, seeded } = setup({ [`${HOST}/sitemap.xml`]: ok(urlset([`${HOST}/docs/a`])) }, flaky);
    await seed();
    expect(seeded()).toEqual([`${HOST}/docs/start`]);
  });
});
