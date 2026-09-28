import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { FakeFetcher, HOST, createHarness, html, makeClockedPacer, makeConfig, page, status } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 6 — R3 리뷰(High 4 / Medium 8 / Low 8)와 아키텍트 RG-16~RG-20의 재현 시험(크롤 단계).
 * 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·크롤러, 네트워크·시간·문서 해석만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const okRobots = (f: FakeFetcher, body = 'User-agent: *\nAllow: /\n'): FakeFetcher => f.route(`${HOST}/robots.txt`, html(body));
const redirect = (location: string, code = 302): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const docOf = (h: Harness, sourceId: string, path: string) => h.prisma.kbDocument.findUniqueOrThrow({ where: { sourceId_urlHash: { sourceId, urlHash: urlHash(`${HOST}${path}`) } } });

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  const kind = (over.kind as string | undefined) ?? 'HTML';
  const ext = kind === 'PDF' ? 'pdf' : kind === 'HTML' ? 'html' : (kind.toLowerCase() as 'docx');
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind, externalFileName: buildExternalFileName(sourceId, url, ext), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

/** 이 본문이 이미 외부 RAG에 적재된 것처럼 문서 행의 해시·지문·적재 시각을 채운다(HTML · 마스킹 켬 · 변환 DOCX 기본값). */
async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  const ingestFingerprint = computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' });
  return { contentHash, ingestFingerprint, textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

describe('KB pass 6 — 크롤 단계', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass6-crawl');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  }, 15_000);

  /** 같은 호스트를 쓰는 소스가 여럿이라(RG-18) 앞 시험이 남긴 진행 중 실행이 뒤 시험의 크롤 시작을 막지 않게 매 시험 뒤 정리한다. */
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.prisma.kbSyncRun.updateMany({ where: { status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
    await h.prisma.kbSource.updateMany({ data: { activeRunId: null } });
    // 소스 등록 상한(50)과 호스트 겹침 판정이 시험 사이에 새지 않도록 문서·소스도 비운다.
    await h.prisma.kbIngestJob.deleteMany({});
    await h.prisma.kbDocument.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
  });

  /* ───────────────────────── H-1 ───────────────────────── */
  describe('H-1 — 정규화 뒤 같은 URL(/docs/a 와 /docs/a#intro)이 함께 링크돼도 실행이 실패하지 않는다', () => {
    it('★ 같은 페이지를 가리키는 링크가 여럿이어도 SUCCEEDED · 문서는 한 번만 방문한다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a', '/docs/a#intro', '/docs/a#other', '/docs/b'])))
        .route(`${HOST}/docs/a`, html(page('A')))
        .route(`${HOST}/docs/b`, html(page('B')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      expect(run.status).toBe('SUCCEEDED');
      expect(run.failureCode).toBeNull();
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(1);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id } })).toBe(3);
    });

    it('★ 저장소 seedFrontier도 같은 urlHash 중복을 방어적으로 걸러낸다(유니크 위반 없이 1행)', async () => {
      const { id } = await h.createSource();
      const url = `${HOST}/docs/dup`;
      const entry = { url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(id, url, 'html'), depth: 1 };
      await expect(h.store.seedFrontier(id, 'run-x', [entry, { ...entry }, { ...entry, depth: 2 }])).resolves.toBe(1);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, urlHash: entry.urlHash } })).toBe(1);
    });

    it('★ 링크 발견 중 예외가 나도 이미 응답을 받은 시작 주소는 "도달"로 남는다 — 실행이 ALL_SEEDS_UNREACHABLE로 오판되지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']))).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'PREVIEW');
      const real = h.store.seedFrontier.bind(h.store);
      let calls = 0;
      jest.spyOn(h.store, 'seedFrontier').mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error('DB 오류(시뮬레이션)'); // 1번 = 씨앗 · 2번 = 시작 주소 페이지의 링크 발견
        return real(...args);
      });
      jest.spyOn(runner['logger'], 'error').mockImplementation(() => undefined);

      const run = await h.drive(runner, runId);
      expect(run.status).not.toBe('FAILED');
      expect(run.failureCode).toBeNull();
    });
  });

  /* ───────────────────────── H-2 ───────────────────────── */
  /** 첫 크롤(미리보기)로 만든 문서들을 "이미 적재된" 상태로 만든다 — 다음 SYNC 실행이 변경 없음(UNCHANGED)으로 판정하도록. */
  async function primeIngested(sourceId: string, pages: Record<string, string>, etags: Record<string, string> = {}) {
    for (const [path, body] of Object.entries(pages)) {
      await h.prisma.kbDocument.updateMany({ where: { sourceId, urlHash: urlHash(`${HOST}${path}`) }, data: { ...(await ingestedFields(body)), etag: etags[path] ?? null } });
    }
  }

  describe('H-2 — 부모가 304·장애라 링크를 다시 확인하지 못해도 자식의 삭제·변경 판정이 오염되지 않는다', () => {
    const rootBody = (links: string[]) => page('목록', links);

    it('★ 304인 부모의 자식은 링크가 없어도 이어 방문하고(UNCHANGED면 "없어짐"이 아니다), 자식이 진짜 404면 연속 2회에 GONE이다', async () => {
      const { id } = await h.createSource();
      const root = rootBody(['/docs/a', '/docs/b']);
      const bodies = { '/docs/': root, '/docs/a': page('A'), '/docs/b': page('B') };
      const first = okRobots(new FakeFetcher()).route(DOCS, html(root)).route(`${HOST}/docs/a`, html(bodies['/docs/a'])).route(`${HOST}/docs/b`, html(bodies['/docs/b']));
      await h.drive(h.makeRunner({ fetcher: first }).runner, await h.startRun(id, 'PREVIEW'));
      await primeIngested(id, bodies, { '/docs/': '"r1"', '/docs/a': '"a1"', '/docs/b': '"b1"' });

      const site = () =>
        okRobots(new FakeFetcher())
          .route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304, { etag: '"r1"' }) : html(root, { etag: '"r1"' })))
          .route(`${HOST}/docs/a`, (r) => (r.headers['if-none-match'] === '"a1"' ? status(304, { etag: '"a1"' }) : html(bodies['/docs/a'], { etag: '"a1"' })))
          .route(`${HOST}/docs/b`, status(404));

      const f2 = site();
      const run2 = await h.drive(h.makeRunner({ fetcher: f2 }).runner, await h.startRun(id, 'SYNC'));
      expect(run2.status).not.toBe('FAILED');
      expect(f2.hitsOf(`${HOST}/docs/a`)).toBe(1); // 부모가 304여도 자식은 이어 방문한다.
      expect(f2.hitsOf(`${HOST}/docs/b`)).toBe(1);
      expect((await docOf(h, id, '/docs/a')).missingStreak).toBe(0);
      expect((await docOf(h, id, '/docs/b')).missingStreak).toBe(1); // 진짜 404 — 첫 관측.

      const run3 = await h.drive(h.makeRunner({ fetcher: site() }).runner, await h.startRun(id, 'SYNC'));
      expect(run3.status).not.toBe('FAILED');
      const a = await docOf(h, id, '/docs/a');
      const b = await docOf(h, id, '/docs/b');
      expect(a.state).toBe('ACTIVE'); // 멀쩡한 자식은 삭제로 세지지 않는다.
      expect(a.missingStreak).toBe(0);
      expect(b.state).toBe('GONE'); // 연속 2회 404
      expect(b.cleanupReason).toBe('GONE');
    });

    it('★ 부모가 304여도 바뀐 자식은 CHANGED로 잡힌다(안 바뀐 목록 페이지 아래 문서 변경이 영영 누락되지 않는다)', async () => {
      const { id } = await h.createSource();
      const root = rootBody(['/docs/a']);
      const first = okRobots(new FakeFetcher()).route(DOCS, html(root)).route(`${HOST}/docs/a`, html(page('A')));
      await h.drive(h.makeRunner({ fetcher: first }).runner, await h.startRun(id, 'PREVIEW'));
      await primeIngested(id, { '/docs/': root, '/docs/a': page('A') }, { '/docs/': '"r1"' });

      const f = okRobots(new FakeFetcher())
        .route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304) : html(root)))
        .route(`${HOST}/docs/a`, html(page('A — 개정판', [], '개정된 본문입니다. '.repeat(20))));
      const runId = await h.startRun(id, 'SYNC');
      await h.drive(h.makeRunner({ fetcher: f }).runner, runId);
      const a = await docOf(h, id, '/docs/a');
      expect(a.observedChange).toBe('CHANGED');
      expect(await h.prisma.kbIngestJob.count({ where: { runId, documentId: a.id } })).toBe(1);
    });

    it('★ 일부 시작 주소만 5xx면 그 아래 문서를 GONE으로 세지 않고 개별로 확인한다(다른 시작 주소는 정상)', async () => {
      const { id } = await h.createSource({ seedUrls: [DOCS, `${HOST}/docs/other/`] });
      const okRoot = rootBody(['/docs/a']);
      const otherRoot = rootBody(['/docs/other/o1', '/docs/other/o2']);
      const pages: Record<string, string> = { '/docs/': okRoot, '/docs/a': page('A'), '/docs/other/': otherRoot, '/docs/other/o1': page('O1'), '/docs/other/o2': page('O2') };
      const build = (otherDown: boolean) => {
        const f = okRobots(new FakeFetcher());
        for (const [p, body] of Object.entries(pages)) f.route(`${HOST}${p}`, html(body));
        if (otherDown) f.route(`${HOST}/docs/other/`, status(503));
        return f;
      };
      await h.drive(h.makeRunner({ fetcher: build(false) }).runner, await h.startRun(id, 'PREVIEW'));
      await primeIngested(id, pages);

      for (let i = 0; i < 3; i += 1) {
        const f = build(true);
        const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
        expect(run.status).not.toBe('FAILED'); // 시작 주소 하나는 응답했다.
        expect(f.hitsOf(`${HOST}/docs/other/o1`)).toBe(1); // 죽은 시작 주소의 자식도 개별로 확인한다.
      }
      for (const p of ['/docs/other/o1', '/docs/other/o2', '/docs/a']) {
        const d = await docOf(h, id, p);
        expect(d.state).toBe('ACTIVE');
        expect(d.missingStreak).toBe(0);
        expect(d.cleanupReason).toBeNull();
      }
    });

    it('링크가 정말 사라진 자식(부모가 200으로 응답했는데 링크가 없음)은 여전히 "다시 발견되지 않음"으로 센다(대조)', async () => {
      const { id } = await h.createSource();
      const root = rootBody(['/docs/a', '/docs/b']);
      const first = okRobots(new FakeFetcher()).route(DOCS, html(root)).route(`${HOST}/docs/a`, html(page('A'))).route(`${HOST}/docs/b`, html(page('B')));
      await h.drive(h.makeRunner({ fetcher: first }).runner, await h.startRun(id, 'PREVIEW'));
      await primeIngested(id, { '/docs/': root, '/docs/a': page('A'), '/docs/b': page('B') });
      const shrunkRoot = rootBody(['/docs/a']); // b 링크 삭제(목록 본문이 바뀌어 CHANGED → 적재 작업이 생기지만 이 시험은 삭제 감지만 본다)
      for (let i = 0; i < 2; i += 1) {
        const f = okRobots(new FakeFetcher()).route(DOCS, html(shrunkRoot)).route(`${HOST}/docs/a`, html(page('A')));
        const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
        if (run.status === 'INGESTING') await h.sourcesService.finishIngestingAndRelease(id, run.id, 'SUCCEEDED', new Date()); // 목록이 바뀌어 적재 작업이 생겼다 — 다음 실행을 위해 끝낸다.
        expect(f.hitsOf(`${HOST}/docs/b`)).toBe(0);
      }
      expect((await docOf(h, id, '/docs/b')).state).toBe('GONE');
      expect((await docOf(h, id, '/docs/a')).state).toBe('ACTIVE');
    });
  });

  /* ───────────────────────── RG-16 ───────────────────────── */
  describe('RG-16 — 리다이렉트', () => {
    it('★ 최종 URL로 문서를 기록하고, 상대 링크는 최종 URL 기준으로 해석하며, 같은 문서를 두 번 받지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/a'])))
        .route(`${HOST}/docs/a`, redirect('/docs/a/', 301))
        .route(`${HOST}/docs/a/`, html(page('A 폴더', ['b'])))
        .route(`${HOST}/docs/a/b`, html(page('A의 B')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));

      expect(run.status).toBe('SUCCEEDED');
      const from = await docOf(h, id, '/docs/a');
      expect(from.visitState).toBe('VISITED');
      expect(from.observedChange).toBeNull(); // 원래 URL은 방문 표시만 — 적재 후보가 아니다.
      const to = await docOf(h, id, '/docs/a/');
      expect(to.title).toBe('A 폴더');
      expect(to.observedChange).toBe('NEW');
      expect(fetcher.hitsOf(`${HOST}/docs/a/`)).toBe(1); // 최종 URL을 다시 받지 않는다.
      expect(fetcher.hitsOf(`${HOST}/docs/a/b`)).toBe(1); // 상대 링크 'b' → /docs/a/b (최종 URL 기준)
      expect(fetcher.hitsOf(`${HOST}/docs/b`)).toBe(0); // 원래 URL 기준이면 여기로 갔을 것이다.
    });

    it.each([
      ['다른 호스트로', () => redirect('https://out.example/x')],
      ['https → http 하향', () => redirect('http://a.example/docs/x')],
      ['경로 접두 밖으로', () => redirect('/other/x')],
    ])('★ %s 가면 EXCLUDED(REDIRECT_OUT_OF_SCOPE) — 요청은 나가지 않고 시작 주소 도달로 센다', async (_l, res) => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/r']))).route(`${HOST}/docs/r`, res());
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const d = await docOf(h, id, '/docs/r');
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('REDIRECT_OUT_OF_SCOPE');
      expect(fetcher.urls().some((u) => u.includes('out.example') || u.includes('http://'))).toBe(false);
      expect((JSON.parse(run.counts) as { excluded: Record<string, number> }).excluded.REDIRECT_OUT_OF_SCOPE).toBe(1);
    });

    it('★ 인증 헤더는 시작 호스트로 가는 요청에만 싣는다 — 리다이렉트가 다른 허용 호스트로 가도 그 호스트에는 보내지 않는다(§6.9)', async () => {
      const { id } = await h.createSource({
        seedUrls: [DOCS, 'https://b.example/docs/'],
        auth: { kind: 'STATIC_HEADER', headerName: 'X-Api-Key', secretRef: 'KB_TEST' },
      });
      const fetcher = new FakeFetcher()
        .route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n'))
        .route('https://b.example/robots.txt', html('User-agent: *\nAllow: /\n'))
        .route(DOCS, html(page('목록', ['/docs/r'])))
        .route(`${HOST}/docs/r`, redirect('https://b.example/docs/x'))
        .route('https://b.example/docs/', html(page('B 목록')))
        .route('https://b.example/docs/x', html(page('B의 X')));
      const { runner } = h.makeRunner({ fetcher, secretResolver: { get: () => 'top-secret' } });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const req = (url: string) => fetcher.requests.find((r) => r.url === url);
      expect(req(`${HOST}/docs/r`)?.headers['x-api-key']).toBe('top-secret'); // 시작 호스트(a.example)
      expect(req('https://b.example/docs/x')).toBeDefined(); // 리다이렉트는 따라갔다
      expect(req('https://b.example/docs/x')?.headers['x-api-key']).toBeUndefined(); // 다른 호스트에는 자격증명을 보내지 않는다
    });

    it('★ 4번째 hop과 순환도 REDIRECT_OUT_OF_SCOPE로 제외한다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/c0', '/docs/l0'])))
        .route(`${HOST}/docs/c0`, redirect('/docs/c1'))
        .route(`${HOST}/docs/c1`, redirect('/docs/c2'))
        .route(`${HOST}/docs/c2`, redirect('/docs/c3'))
        .route(`${HOST}/docs/c3`, redirect('/docs/c4'))
        .route(`${HOST}/docs/c4`, html(page('도달하면 안 됨')))
        .route(`${HOST}/docs/l0`, redirect('/docs/l1'))
        .route(`${HOST}/docs/l1`, redirect('/docs/l0'));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/c4`)).toBe(0);
      for (const p of ['/docs/c0', '/docs/l0']) {
        const d = await docOf(h, id, p);
        expect(d.state).toBe('EXCLUDED');
        expect(d.excludeReason).toBe('REDIRECT_OUT_OF_SCOPE');
      }
    });

    it('★ 홉마다 robots를 다시 확인하고 페이싱한다 — 리다이렉트 대상이 robots로 막혔으면 요청하지 않는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nDisallow: /docs/private\n')
        .route(DOCS, html(page('목록', ['/docs/r'])))
        .route(`${HOST}/docs/r`, redirect('/docs/private/x'))
        .route(`${HOST}/docs/private/x`, html(page('비공개')));
      const { runner, pacer } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/private/x`)).toBe(0);
      const d = await docOf(h, id, '/docs/r');
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('ROBOTS');
      // 요청 하나하나가 페이서를 거쳤다(robots 1 · 목록 1 · 리다이렉트 응답 1).
      expect(pacer.releases.length).toBe(fetcher.requests.length);
    });

    it('★ robots.txt가 같은 호스트 안에서 리다이렉트되면 따라가 규칙을 적용한다(최대 3회)', async () => {
      const { id } = await h.createSource();
      const fetcher = new FakeFetcher()
        .route(`${HOST}/robots.txt`, redirect('/robots-v2.txt', 301))
        .route(`${HOST}/robots-v2.txt`, html('User-agent: *\nDisallow: /docs/secret\n'))
        .route(DOCS, html(page('목록', ['/docs/secret', '/docs/open'])))
        .route(`${HOST}/docs/open`, html(page('공개')))
        .route(`${HOST}/docs/secret`, html(page('비밀')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(JSON.parse(run.abortedHosts)).toEqual([]);
      expect(fetcher.hitsOf(`${HOST}/docs/secret`)).toBe(0);
      expect(fetcher.hitsOf(`${HOST}/docs/open`)).toBe(1);
    });

    it('robots.txt 리다이렉트는 최대 3회 — 3회는 따라가고 4회째는 그 호스트 수집을 중단한다', async () => {
      const ok = await h.createSource();
      const three = new FakeFetcher()
        .route(`${HOST}/robots.txt`, redirect('/r1.txt'))
        .route(`${HOST}/r1.txt`, redirect('/r2.txt'))
        .route(`${HOST}/r2.txt`, redirect('/r3.txt'))
        .route(`${HOST}/r3.txt`, html('User-agent: *\nDisallow: /docs/secret\n'))
        .route(DOCS, html(page('목록', ['/docs/secret'])));
      const okRun = await h.drive(h.makeRunner({ fetcher: three }).runner, await h.startRun(ok.id, 'PREVIEW'));
      expect(okRun.status).toBe('SUCCEEDED');
      expect(three.hitsOf(`${HOST}/docs/secret`)).toBe(0);

      const bad = await h.createSource();
      const four = new FakeFetcher()
        .route(`${HOST}/robots.txt`, redirect('/r1.txt'))
        .route(`${HOST}/r1.txt`, redirect('/r2.txt'))
        .route(`${HOST}/r2.txt`, redirect('/r3.txt'))
        .route(`${HOST}/r3.txt`, redirect('/r4.txt'))
        .route(`${HOST}/r4.txt`, html('User-agent: *\nAllow: /\n'))
        .route(DOCS, html(page('목록')));
      const badRun = await h.drive(h.makeRunner({ fetcher: four }).runner, await h.startRun(bad.id, 'PREVIEW'));
      expect(badRun.failureCode).toBe('ROBOTS_UNREACHABLE');
      expect(four.hitsOf(`${HOST}/r4.txt`)).toBe(0);
      expect(four.hitsOf(DOCS)).toBe(0);
    });

    it('robots.txt가 다른 호스트로 리다이렉트되면 그 호스트 수집을 중단한다(범위 밖 = 보수적)', async () => {
      const { id } = await h.createSource();
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, redirect('https://out.example/robots.txt')).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ROBOTS_UNREACHABLE');
      expect(fetcher.hitsOf(DOCS)).toBe(0);
    });
  });

  /* ───────────────────────── M-3 ───────────────────────── */
  describe('M-3 — robots.txt 4xx는 캐시하고 robots 요청도 페이싱한다 · 429는 서버 오류', () => {
    it('★ robots.txt가 404여도 실행 안에서 한 번만 받는다(문서마다 다시 요청하지 않는다) · 모든 요청이 페이서를 거친다', async () => {
      const { id } = await h.createSource();
      const fetcher = new FakeFetcher()
        .route(`${HOST}/robots.txt`, status(404))
        .route(DOCS, html(page('목록', ['/docs/a', '/docs/b', '/docs/c'])))
        .route(`${HOST}/docs/a`, html(page('A')))
        .route(`${HOST}/docs/b`, html(page('B')))
        .route(`${HOST}/docs/c`, html(page('C')));
      const { runner, pacer } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/robots.txt`)).toBe(1);
      expect(fetcher.requests).toHaveLength(5); // robots 1 + 페이지 4
      expect(pacer.releases).toHaveLength(5);
    });

    it('★ robots.txt가 429면 허용이 아니라 서버 오류 — 그 호스트 수집 중단(ROBOTS_UNREACHABLE)', async () => {
      const { id } = await h.createSource();
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, status(429)).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.failureCode).toBe('ROBOTS_UNREACHABLE');
      expect(fetcher.hitsOf(DOCS)).toBe(0);
    });
  });

  /* ───────────────────────── M-4 ───────────────────────── */
  describe('M-4 — 한글(비ASCII) 경로', () => {
    it('★ robots Disallow: /docs/관리 가 한글 링크(퍼센트 인코딩으로 요청되는 경로)를 막는다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nDisallow: /docs/관리\n')
        .route(DOCS, html(page('목록', ['/docs/관리/목록', '/docs/공지'])))
        .route(`${HOST}/docs/${encodeURIComponent('관리')}/${encodeURIComponent('목록')}`, html(page('관리')))
        .route(`${HOST}/docs/${encodeURIComponent('공지')}`, html(page('공지')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.urls().some((u) => u.includes(encodeURIComponent('관리')))).toBe(false); // 관리 아래는 요청하지 않는다.
      expect(fetcher.hitsOf(`${HOST}/docs/${encodeURIComponent('공지')}`)).toBe(1);
      const blocked = await h.prisma.kbDocument.findFirstOrThrow({ where: { sourceId: id, url: { contains: encodeURIComponent('관리') } } });
      expect(blocked.excludeReason).toBe('ROBOTS');
    });

    it('★ robots 쿼리 매칭 — Disallow: /*?sid= 는 쿼리가 있는 URL을 막는다', async () => {
      const { id } = await h.createSource({ allowQueryUrls: true });
      const fetcher = okRobots(new FakeFetcher(), 'User-agent: *\nDisallow: /*?sid=\n')
        .route(DOCS, html(page('목록', ['/docs/p?sid=abc', '/docs/p?page=2'])))
        .route(`${HOST}/docs/p?page=2`, html(page('2쪽')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(fetcher.hitsOf(`${HOST}/docs/p?sid=abc`)).toBe(0);
      expect(fetcher.hitsOf(`${HOST}/docs/p?page=2`)).toBe(1);
    });

    it('★ pathPrefixes에 한글 원문(/docs/규정)을 적어도 그 아래 링크가 범위 안이다', async () => {
      const seed = `${HOST}/docs/${encodeURIComponent('규정')}/`;
      const { id } = await h.createSource({ seedUrls: [seed], pathPrefixes: ['/docs/규정'] });
      const fetcher = okRobots(new FakeFetcher())
        .route(seed, html(page('규정 목록', ['/docs/규정/인사', '/docs/다른/문서'])))
        .route(`${HOST}/docs/${encodeURIComponent('규정')}/${encodeURIComponent('인사')}`, html(page('인사 규정')));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(fetcher.hitsOf(`${HOST}/docs/${encodeURIComponent('규정')}/${encodeURIComponent('인사')}`)).toBe(1);
      expect(fetcher.urls().some((u) => u.includes(encodeURIComponent('다른')))).toBe(false); // 범위 밖
    });
  });

  /* ───────────────────────── M-5 ───────────────────────── */
  describe('M-5 — noindex와 nofollow는 별개', () => {
    it('★ noindex만 있는 페이지도 링크는 따라간다(적재만 제외)', async () => {
      const { id } = await h.createSource();
      const noindexPage = `<html><head><meta name="robots" content="noindex"><title>색인 제외</title></head><body><main><h1>색인 제외</h1><p>${'본문 '.repeat(80)}</p><a href="/docs/a">A</a></main></body></html>`;
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(noindexPage)).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect((await docOf(h, id, '/docs/')).excludeReason).toBe('NOINDEX');
      expect(fetcher.hitsOf(`${HOST}/docs/a`)).toBe(1);
    });

    it('X-Robots-Tag noindex만 있어도 링크를 따라가고, noindex + nofollow면 따라가지 않는다', async () => {
      const { id } = await h.createSource();
      const f1 = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']), { 'x-robots-tag': 'noindex' })).route(`${HOST}/docs/a`, html(page('A')));
      await h.drive(h.makeRunner({ fetcher: f1 }).runner, await h.startRun(id, 'PREVIEW'));
      expect(f1.hitsOf(`${HOST}/docs/a`)).toBe(1);

      const s2 = await h.createSource();
      const f2 = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']), { 'x-robots-tag': 'noindex, nofollow' })).route(`${HOST}/docs/a`, html(page('A')));
      await h.drive(h.makeRunner({ fetcher: f2 }).runner, await h.startRun(s2.id, 'PREVIEW'));
      expect(f2.hitsOf(`${HOST}/docs/a`)).toBe(0);
    });
  });

  /* ───────────────────────── M-8 · RG-20① ───────────────────────── */
  describe('M-8 / RG-20① — 요청 없이 제외된 시작 주소(RAW_FILE_OFF)는 "도달"이 아니다', () => {
    it('★ 시작 주소 중 문서 파일(원본 전달 꺼짐)은 도달이 아니다 — 요청을 보낸 시작 주소가 전부 실패면 FAILED · 기존 문서는 삭제로 세지 않는다', async () => {
      const { id } = await h.createSource({ seedUrls: [`${HOST}/docs/guide.pdf`, DOCS], allowRawFileIngest: false });
      await addDoc(h, id, '/docs/old1', { lastIngestedAt: new Date(Date.now() - 86_400_000), contentHash: 'h1' });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, status(503));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect(run.status).toBe('FAILED');
      expect(run.failureCode).toBe('ALL_SEEDS_UNREACHABLE');
      expect((await docOf(h, id, '/docs/old1')).missingStreak).toBe(0);
    });

    it('시작 주소가 전부 원본 전달 꺼진 문서 파일뿐이면(요청 0) 사이트 장애로 오판하지 않는다', async () => {
      const { id } = await h.createSource({ seedUrls: [`${HOST}/docs/guide.pdf`], allowRawFileIngest: false });
      const fetcher = okRobots(new FakeFetcher());
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(fetcher.requests.filter((r) => r.url.endsWith('.pdf'))).toHaveLength(0);
    });
  });

  /* ───────────────────────── RG-20 ───────────────────────── */
  describe('RG-20 — 정합성 묶음', () => {
    it('② PII_IN_RAW_FILE로 제외한 파일도 개인정보 건수를 기록한다', async () => {
      const { id } = await h.createSource({ allowRawFileIngest: true });
      const ext = {
        async extract(req: { kind: string }) {
          if (req.kind === 'HTML') return new InProcessExtractor().extract(req as never);
          return { ok: true, normalizedText: 'x', text: 'x', piiMaskedCount: 4, flags: [] };
        },
      };
      const fetcher = okRobots(new FakeFetcher())
        .route(DOCS, html(page('목록', ['/docs/f.pdf'])))
        .route(`${HOST}/docs/f.pdf`, { kind: 'RESPONSE', status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4'), headers: {} });
      const { runner } = h.makeRunner({ fetcher, extractor: ext as never, config: makeConfig({ DATA_GOVERNANCE_MODE: 'ON' }) });
      const run = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const d = await docOf(h, id, '/docs/f.pdf');
      expect(d.excludeReason).toBe('PII_IN_RAW_FILE');
      expect(d.observedPiiMasked).toBe(4);
      expect((JSON.parse(run.counts) as { piiMasked: number }).piiMasked).toBeGreaterThanOrEqual(4);
    });

    it('② 이번 실행에서 다시 재지 않은 행(304)의 지난 실행 개인정보 건수는 요약 합계에 섞이지 않는다(실행마다 초기화)', async () => {
      const { id } = await h.createSource();
      const root = page('목록');
      await addDoc(h, id, '/docs/', { ...(await ingestedFields(root)), etag: '"r1"', observedPiiMasked: 9 });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, (r) => (r.headers['if-none-match'] === '"r1"' ? status(304) : html(root)));
      const { runner } = h.makeRunner({ fetcher });
      const run = await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect((JSON.parse(run.counts) as { piiMasked: number }).piiMasked).toBe(0);
    });

    it('⑤ 종결 도중 실패해 다시 종결해도 요약의 없어짐 건수가 줄어들지 않는다', async () => {
      const { id } = await h.createSource();
      const past = new Date(Date.now() - 86_400_000);
      await addDoc(h, id, '/docs/old1', { lastIngestedAt: past, contentHash: 'h1' });
      await addDoc(h, id, '/docs/old2', { lastIngestedAt: past, contentHash: 'h2' });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록')));
      const { runner } = h.makeRunner({ fetcher });
      jest.spyOn(runner['logger'], 'error').mockImplementation(() => undefined);
      const runId = await h.startRun(id, 'SYNC');
      jest.spyOn(h.sourcesService, 'finishCrawlAndRelease').mockRejectedValueOnce(new Error('종결 직전 크래시(시뮬레이션)'));
      await h.fragment(runner, runId);
      expect((await h.store.findRun(runId))?.status).toBe('CRAWLING');
      const run = await h.drive(runner, runId);
      expect((JSON.parse(run.counts) as { missing: number }).missing).toBe(2);
    });

    it('Low-1 — 중단 호스트의 문서는 상태·제외 사유가 덮이지 않는다', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/', { state: 'EXCLUDED', excludeReason: 'NOINDEX' });
      const fetcher = new FakeFetcher().route(`${HOST}/robots.txt`, status(503));
      const { runner } = h.makeRunner({ fetcher });
      await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      const d = await docOf(h, id, '/docs/');
      expect(d.state).toBe('EXCLUDED');
      expect(d.excludeReason).toBe('NOINDEX');
    });

    it('Low-6 — 발견 순서 번호는 소스 전체 최대값 다음부터 이어진다', async () => {
      const { id } = await h.createSource();
      await addDoc(h, id, '/docs/big', { discoveredSeq: 500 });
      const mk = (p: string) => ({ url: `${HOST}${p}`, urlHash: urlHash(`${HOST}${p}`), kind: 'HTML', externalFileName: buildExternalFileName(id, `${HOST}${p}`, 'html'), depth: 1 });
      await h.store.seedFrontier(id, 'run-y', [mk('/docs/n1'), mk('/docs/n2')]);
      const rows = await h.prisma.kbDocument.findMany({ where: { sourceId: id, urlHash: { in: [urlHash(`${HOST}/docs/n1`), urlHash(`${HOST}/docs/n2`)] } }, orderBy: { discoveredSeq: 'asc' } });
      expect(rows.map((r) => r.discoveredSeq)).toEqual([501, 502]);
    });
  });

  /* ───────────────────────── RG-17 ───────────────────────── */
  describe('RG-17 — 크롤 처리량(조각 안에서 요청 간격을 기다리며 계속한다)', () => {
    it('★ 실제 KbHostPacer(가짜 시계)로 13쪽이 한 조각에서 끝난다 — 요청 간격은 500ms 이상 지킨다', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500 });
      const kids = Array.from({ length: 12 }, (_, i) => `/docs/k${i}`);
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, html(page(k)));
      const times: Array<{ url: string; at: number }> = [];
      fetcher.onRequest = (r) => {
        times.push({ url: r.url, at: clock.t });
      };
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      await h.fragment(runner, runId, { deadlineAt: clock.t + 25_000 });

      const run = await h.store.findRun(runId);
      expect(run?.status).toBe('SUCCEEDED'); // 한 조각에서 끝났다(예전에는 조각당 약 1쪽).
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, visitState: 'VISITED' } })).toBe(13);
      const pageTimes = times.filter((t) => !t.url.endsWith('/robots.txt'));
      const gaps = pageTimes.slice(1).map((t, i) => t.at - pageTimes[i].at);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(500);
      expect(clock.t - 1_000_000).toBeLessThan(25_000);
    });

    it('★ 남은 지연이 조각 예산을 넘으면 그 자리에서 조각을 끝낸다(다음 조각에 이어감) — 대기하다 예산을 넘기지 않는다', async () => {
      const { id } = await h.createSource({ minIntervalMs: 500, maxPages: 200 });
      const kids = Array.from({ length: 100 }, (_, i) => `/docs/k${i}`);
      const { pacer, clock } = makeClockedPacer();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      for (const k of kids) fetcher.route(`${HOST}${k}`, html(page(k)));
      const { runner } = h.makeRunner({ fetcher, pacer });
      const runId = await h.startRun(id, 'PREVIEW');
      const start = clock.t;
      await h.fragment(runner, runId, { deadlineAt: start + 10_000 });
      expect((await h.store.findRun(runId))?.status).toBe('CRAWLING');
      const visited = await h.prisma.kbDocument.count({ where: { sourceId: id, visitState: 'VISITED' } });
      expect(visited).toBeGreaterThanOrEqual(15); // 10초 / 0.5초 ≈ 20쪽(robots·목록 포함)
      expect(visited).toBeLessThanOrEqual(21);
      expect(clock.t).toBeLessThanOrEqual(start + 10_000 + 1);

      await h.fragment(runner, runId, { deadlineAt: clock.t + 25_000 }); // 다음 조각이 이어서 처리한다.
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, visitState: 'VISITED' } })).toBeGreaterThan(visited);
    });
  });

  /* ───────────────────────── RG-18 ───────────────────────── */
  describe('RG-18 — 호스트가 겹치는 소스는 동시에 크롤하지 않는다(크롤 시작 게이트)', () => {
    const lease = (runId: string) => h.store.claimCrawlLease(runId, 600_000, new Date());

    it('★ 같은 호스트의 두 실행 — 먼저 만든 실행만 CRAWLING이 되고 뒤 실행은 QUEUED로 대기한다', async () => {
      const a = await h.createSource({ seedUrls: [DOCS] });
      const b = await h.createSource({ seedUrls: [`${HOST}/docs/other/`] });
      const runA = await h.startRun(a.id);
      const runB = await h.startRun(b.id);
      expect(await lease(runB)).toBeNull(); // 더 오래된 QUEUED(A)가 앞에 있다.
      expect((await h.store.findRun(runB))?.status).toBe('QUEUED');
      expect(await lease(runA)).not.toBeNull();
      expect(await lease(runB)).toBeNull(); // A가 크롤 중이다.
      await h.prisma.kbSyncRun.update({ where: { id: runA }, data: { status: 'INGESTING', claimToken: null } }); // A 크롤 종결 — 적재 단계는 막지 않는다.
      expect(await lease(runB)).not.toBeNull();
    });

    it('호스트가 겹치지 않으면 동시에 시작한다', async () => {
      const a = await h.createSource({ seedUrls: [DOCS] });
      const b = await h.createSource({ seedUrls: ['https://b.example/docs/'] });
      const runA = await h.startRun(a.id);
      const runB = await h.startRun(b.id);
      expect(await lease(runA)).not.toBeNull();
      expect(await lease(runB)).not.toBeNull();
    });

    it('★ 두 인스턴스가 동시에 시작을 시도해도 겹치는 실행은 하나만 CRAWLING이다(여러 번 반복)', async () => {
      for (let i = 0; i < 8; i += 1) {
        const a = await h.createSource({ seedUrls: [DOCS] });
        const b = await h.createSource({ seedUrls: [DOCS] });
        const runA = await h.startRun(a.id);
        const runB = await h.startRun(b.id);
        const tokens = await Promise.all([lease(runA), lease(runB)]);
        const rows = await h.prisma.kbSyncRun.findMany({ where: { id: { in: [runA, runB] } } });
        // [pass 7 · N-13] `<= 1`은 0개여도 통과한다(둘 다 물러난 경우) — 정확히 1개가 CRAWLING이고 그 실행만 토큰을 받았다(먼저 만든 실행 우선).
        expect(rows.filter((r) => r.status === 'CRAWLING').length).toBe(1);
        expect(tokens.filter((t) => t !== null)).toHaveLength(1);
        await h.prisma.kbSyncRun.updateMany({ where: { id: { in: [runA, runB] } }, data: { status: 'CANCELLED', claimToken: null } });
      }
    });

    it('★ 사후 확인 — 시작 CAS 뒤에 앞선 겹침 실행이 크롤을 시작했으면 QUEUED로 되돌린다', async () => {
      const a = await h.createSource({ seedUrls: [DOCS] });
      const b = await h.createSource({ seedUrls: [DOCS] });
      const runA = await h.startRun(a.id);
      const runB = await h.startRun(b.id);
      const real = h.store.findHostOverlapBlockers.bind(h.store);
      let n = 0;
      jest.spyOn(h.store, 'findHostOverlapBlockers').mockImplementation(async (run, opts) => {
        n += 1;
        if (n === 1) return []; // 시작 전 판정은 통과 — 그 사이 다른 인스턴스가 A를 시작한 상황
        await h.prisma.kbSyncRun.update({ where: { id: runA }, data: { status: 'CRAWLING', claimToken: 'other', claimedAt: new Date(), startedAt: new Date() } });
        return real(run, opts);
      });
      expect(await lease(runB)).toBeNull();
      const row = await h.store.findRun(runB);
      expect(row?.status).toBe('QUEUED');
      expect(row?.claimToken).toBeNull();
    });

    it('★ 같은 tick에 예약된 겹침 소스 2건 중 1건만 크롤을 시작한다(스케줄러 경로)', async () => {
      const a = await h.createSource({ seedUrls: [DOCS] });
      const b = await h.createSource({ seedUrls: [DOCS] });
      await h.prisma.kbSource.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      const created = await h.scheduler.scheduleDueSources(new Date(), 10);
      expect(created).toHaveLength(2); // 예약 시점 필터는 CRAWLING만 보므로 둘 다 QUEUED로 만들어진다
      const results = await Promise.all(created.map((runId) => lease(runId)));
      expect(results.filter((t) => t !== null)).toHaveLength(1);
    });

    it('★ KbSyncJob — 대기 중인 겹침 실행이 앞자리를 막지 않는다(다른 호스트 실행은 계속 처리된다)', async () => {
      const { KbSyncJob } = await import('../kb-sync/engine/kb-sync.job');
      const a = await h.createSource({ seedUrls: [DOCS] });
      const b = await h.createSource({ seedUrls: [`${HOST}/docs/other/`] }); // A와 같은 호스트
      const c = await h.createSource({ seedUrls: ['https://c.example/docs/'] });
      const runA = await h.startRun(a.id);
      const runB = await h.startRun(b.id);
      const runC = await h.startRun(c.id);
      // A는 다른 인스턴스가 유효한 임대로 크롤 중이다(이 인스턴스는 처리하지 않는다) — B는 A와 호스트가 겹쳐 시작할 수 없고, C는 시작해야 한다.
      await h.prisma.kbSyncRun.update({ where: { id: runA }, data: { status: 'CRAWLING', claimToken: 'other-instance', claimedAt: new Date(), startedAt: new Date() } });
      const fetcher = okRobots(new FakeFetcher()).route('https://c.example/robots.txt', html('User-agent: *\nAllow: /\n')).route('https://c.example/docs/', html(page('C')));
      const { runner } = h.makeRunner({ fetcher });
      const job = new KbSyncJob(makeConfig({ KB_SYNC_ENABLED: true, KB_SYNC_MAX_PARALLEL_SOURCES: 2 }), h.store, { scheduleDueSources: async () => [] } as never, runner, { runFragment: async () => false } as never, { now: () => new Date() } as never, new InProcessExtractor());
      await job.tick();
      expect((await h.store.findRun(runB))?.status).toBe('QUEUED'); // 겹침 — 시작하지 않았다.
      expect((await h.store.findRun(runC))?.status).not.toBe('QUEUED'); // B가 앞자리를 막지 않아 C는 처리됐다.
    });
  });

  /* ───────────────────────── M-1 · RG-19 (크롤 종결 경합) ───────────────────────── */
  describe('RG-19 / M-1 — 종결 직전 중지 경합', () => {
    it('★ 종결 직전에 중지되면 방금 만든 적재 작업을 정리한다(PENDING 고아 0 · 문서 표식 0)', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', ['/docs/a']))).route(`${HOST}/docs/a`, html(page('A')));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      const real = h.store.findIngestCandidates.bind(h.store);
      jest.spyOn(h.store, 'findIngestCandidates').mockImplementation(async (...args) => {
        const cands = await real(...args);
        await h.sourcesService.cancelRunAndRelease(id, runId, new Date(), 'user-1', 'CANCELLED_BY_USER'); // 리뷰어가 재현한 창 — 후보 조회 직후 중지
        return cands;
      });
      await h.drive(runner, runId);

      expect((await h.store.findRun(runId))?.status).toBe('CANCELLED');
      expect(await h.prisma.kbIngestJob.count({ where: { runId, status: 'PENDING' } })).toBe(0);
      expect(await h.prisma.kbIngestJob.count({ where: { runId } })).toBeGreaterThan(0);
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, activeIngestJobId: { not: null } } })).toBe(0);
    });

    /** 새로 비율 가드(EX-KB-7)를 일으키는 설정 — 이미 적재된 문서 20개 + 이번에 새로 발견되는 12쪽(12/20 > 50%). */
    async function newRatioSetup() {
      const { id } = await h.createSource();
      const past = new Date(Date.now() - 86_400_000);
      for (let i = 0; i < 20; i += 1) await addDoc(h, id, `/docs/old${i}`, { lastIngestedAt: past, contentHash: `h${i}` });
      const kids = Array.from({ length: 11 }, (_, i) => `/docs/n${i}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', kids)));
      kids.forEach((k, i) => fetcher.route(`${HOST}${k}`, html(page(`새 문서 ${i}`, [], `고유 본문 ${i}번. `.repeat(30)))));
      return { id, fetcher };
    }

    it('★ M-1: 자동 강등은 종결 CAS가 성공한 뒤에만 반영한다 — 중지된 실행이 소스 승인을 해제하지 않는다', async () => {
      const { id, fetcher } = await newRatioSetup();
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      const real = h.store.countRunObservations.bind(h.store);
      jest.spyOn(h.store, 'countRunObservations').mockImplementation(async (...args) => {
        const r = await real(...args);
        await h.sourcesService.cancelRunAndRelease(id, runId, new Date(), 'user-1', 'CANCELLED_BY_USER'); // 가드 판정 직전에 중지
        return r;
      });
      await h.drive(runner, runId);
      expect((await h.store.findRun(runId))?.status).toBe('CANCELLED');
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBe(1); // 강등되지 않았다.
      expect(source.reviewRequiredReason).toBeNull();
    });

    it('대조: 중지 없이 종결하면 자동 강등이 반영된다', async () => {
      const { id, fetcher } = await newRatioSetup();
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('NEW_RATIO');
      expect(run.status).toBe('SUCCEEDED');
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBeNull();
      expect(source.reviewRequiredReason).toBe('NEW_RATIO');
    });
  });

  /* ───────────────────────── M-7 ───────────────────────── */
  describe('M-7 — 임대 인수 CAS는 읽은 claimedAt이 같을 때만 성공한다', () => {
    it('★ 만료로 읽은 크롤 임대를 인수하려는 순간 원래 보유자가 갱신했으면(토큰 동일 · claimedAt 전진) 인수하지 않는다', async () => {
      const { id } = await h.createSource();
      const runId = await h.startRun(id);
      const old = new Date(Date.now() - 3_600_000);
      await h.prisma.kbSyncRun.update({ where: { id: runId }, data: { status: 'CRAWLING', claimToken: 'holder', claimedAt: old, startedAt: old } });
      const realFind = h.prisma.kbSyncRun.findUnique.bind(h.prisma.kbSyncRun);
      jest.spyOn(h.prisma.kbSyncRun, 'findUnique').mockImplementationOnce(((args: never) =>
        realFind(args).then(async (row) => {
          await h.prisma.kbSyncRun.updateMany({ where: { id: runId }, data: { claimedAt: new Date() } }); // 원래 보유자의 갱신
          return row;
        })) as never);
      expect(await h.store.claimCrawlLease(runId, 600_000, new Date())).toBeNull();
      expect((await h.store.findRun(runId))?.claimToken).toBe('holder');
    });

    it('★ 슬롯 임대도 같다 — 읽은 뒤 보유자가 갱신했으면 낚아채지 않는다', async () => {
      await h.store.ensureLeaseRow('CAS_SLOT_0');
      const old = new Date(Date.now() - 3_600_000);
      await h.prisma.kbJobLease.update({ where: { name: 'CAS_SLOT_0' }, data: { claimToken: 'tok', claimedAt: old } });
      const realFind = h.prisma.kbJobLease.findUnique.bind(h.prisma.kbJobLease);
      jest.spyOn(h.prisma.kbJobLease, 'findUnique').mockImplementationOnce(((args: never) =>
        realFind(args).then(async (row) => {
          await h.prisma.kbJobLease.updateMany({ where: { name: 'CAS_SLOT_0' }, data: { claimedAt: new Date() } });
          return row;
        })) as never);
      expect(await h.store.claimAnySlot(['CAS_SLOT_0'], 600_000, new Date(), 'holder')).toBeNull();
      expect((await h.prisma.kbJobLease.findUniqueOrThrow({ where: { name: 'CAS_SLOT_0' } })).claimToken).toBe('tok');
    });
  });

  /* ───────────────────────── Low-4 ───────────────────────── */
  describe('Low-4 — 예약 예외는 소스 단위로 격리한다', () => {
    it('한 소스의 실행 생성이 예외를 던져도 나머지 소스는 예약되고 tick 전체가 멈추지 않는다', async () => {
      const a = await h.createSource({ seedUrls: ['https://a1.example/docs/'] });
      const b = await h.createSource({ seedUrls: ['https://b1.example/docs/'] });
      await h.prisma.kbSource.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      const real = h.sourcesService.claimAndCreateRun.bind(h.sourcesService);
      let first = true;
      jest.spyOn(h.sourcesService, 'claimAndCreateRun').mockImplementation(async (input) => {
        if (first) {
          first = false;
          throw new Error('DB 오류(시뮬레이션)');
        }
        return real(input);
      });
      const created = await h.scheduler.scheduleDueSources(new Date(), 10);
      expect(created).toHaveLength(1);
    });
  });

});
