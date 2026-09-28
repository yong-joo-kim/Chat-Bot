import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { urlHash } from '../kb-sync/lib/external-file-name';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { FakeFetcher, HOST, createHarness, html, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 8 — RG-21(인증 벽 가드) 재현 시험. 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·크롤러, 네트워크·시간·문서 해석만 가짜.
 * 인증 헤더 비밀·세션이 만료되면 모든 페이지가 200 로그인 폼(또는 로그인 페이지로 3xx)을 돌려주는데, 이때 강등하지 않으면 같은 파일 이름으로 외부 적재본을 로그인 화면으로 덮어쓴다.
 */
const DOCS = `${HOST}/docs/`;
const PATHS = Array.from({ length: 12 }, (_, i) => `/docs/p${i + 1}`);
const redirect = (location: string, code = 302): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const docBody = (i: number): string => page(`문서 ${i}`, [], `문서 ${i}번의 서로 다른 본문입니다. `.repeat(12));
const rootBody = (paths: string[]): string => page('목록', paths);
/** 세션이 만료되면 전형적으로 돌려주는 로그인 화면 — 본문이 짧아 `NO_BODY`로 판정되는 형태(링크는 남는다). */
const shortLogin = (paths: string[]): string => `<html><head><title>로그인</title></head><body><form><label>아이디</label><input name="id"/></form>${paths.map((p) => `<a href="${p}">메뉴</a>`).join('')}</body></html>`;

function healthySite(paths: string[] = PATHS): FakeFetcher {
  const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(rootBody(paths)));
  paths.forEach((p, i) => f.route(`${HOST}${p}`, html(docBody(i + 1))));
  return f;
}

async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  const ingestFingerprint = computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' });
  return { contentHash, ingestFingerprint, textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

describe('KB pass 8 — RG-21 인증 벽 가드', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass8-authwall');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  }, 15_000);

  afterEach(async () => {
    jest.restoreAllMocks();
    await h.prisma.kbSyncRun.updateMany({ where: { status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), claimToken: null } });
    await h.prisma.kbSource.updateMany({ data: { activeRunId: null } });
    await h.prisma.kbIngestJob.deleteMany({});
    await h.prisma.kbDocument.deleteMany({});
    await h.prisma.kbSource.deleteMany({});
  });

  /** 건강한 사이트를 한 번 크롤해 문서를 만들고 "이미 외부에 적재된 것처럼" 표시한다 — 그 뒤 사이트가 로그인 벽으로 바뀌는 상황을 재현한다. */
  async function seedIngestedSource(paths: string[] = PATHS): Promise<string> {
    const { id } = await h.createSource();
    await h.drive(h.makeRunner({ fetcher: healthySite(paths) }).runner, await h.startRun(id, 'PREVIEW'));
    await h.prisma.kbDocument.updateMany({ where: { sourceId: id, urlHash: urlHash(DOCS) }, data: await ingestedFields(rootBody(paths)) });
    for (const [i, p] of paths.entries()) await h.prisma.kbDocument.updateMany({ where: { sourceId: id, urlHash: urlHash(`${HOST}${p}`) }, data: await ingestedFields(docBody(i + 1)) });
    return id;
  }

  async function expectDemoted(sourceId: string, runId: string): Promise<void> {
    const run = await h.store.findRun(runId);
    expect(run?.status).toBe('SUCCEEDED');
    expect(run?.demotedReason).toBe('AUTH_WALL');
    expect(await h.prisma.kbIngestJob.count({ where: { runId } })).toBe(0); // 적재 작업 0 = 외부 RAG로 나가는 것이 없다.
    const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.approvedConfigVersion).toBeNull();
    expect(source.reviewRequiredReason).toBe('AUTH_WALL');
    expect(source.activeRunId).toBeNull();
  }

  const loginSite = (form: string, paths: string[] = PATHS): FakeFetcher => {
    const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(form));
    for (const p of paths) f.route(`${HOST}${p}`, html(form));
    return f;
  };

  describe('(a) 모든 페이지가 같은 로그인 폼(200 · NEW/CHANGED)을 돌려준다', () => {
    it('★ 본문이 충분한 로그인 화면 12쪽 — SYNC가 AUTH_WALL로 강등돼 적재 작업이 만들어지지 않는다', async () => {
      const id = await seedIngestedSource();
      const run = await h.drive(h.makeRunner({ fetcher: loginSite(page('로그인이 필요합니다', PATHS)) }).runner, await h.startRun(id, 'SYNC'));
      await expectDemoted(id, run.id);
    });

    it('★ 짧은 로그인 폼(NO_BODY로 제외되는 형태)도 같은 분포로 잡는다', async () => {
      const id = await seedIngestedSource();
      const run = await h.drive(h.makeRunner({ fetcher: loginSite(shortLogin(PATHS)) }).runner, await h.startRun(id, 'SYNC'));
      await expectDemoted(id, run.id);
    });

    it('★ FULL_RESEND도 강등한다(전량 덮어쓰기라 가장 위험) — 적재 작업 0', async () => {
      const id = await seedIngestedSource();
      const run = await h.drive(h.makeRunner({ fetcher: loginSite(page('로그인이 필요합니다', PATHS)) }).runner, await h.startRun(id, 'FULL_RESEND'));
      await expectDemoted(id, run.id);
    });
  });

  describe('(b) 같은 호스트 로그인 페이지로 3xx 수렴', () => {
    it('★ 12쪽이 /docs/login 으로 리다이렉트 — 로그인 페이지 1건만 NEW로 남아도 강등된다', async () => {
      const id = await seedIngestedSource();
      const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(rootBody(PATHS)));
      for (const p of PATHS) f.route(`${HOST}${p}`, redirect('/docs/login'));
      f.route(`${HOST}/docs/login`, html(page('로그인이 필요합니다')));
      const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
      await expectDemoted(id, run.id);
    });
  });

  describe('(c) 타 호스트(SSO)로 3xx 수렴', () => {
    it('★ 12쪽이 전부 SSO 로그인으로 리다이렉트 — 전부 제외만 되고 경고가 없던 것을 강등으로 알린다', async () => {
      const id = await seedIngestedSource();
      const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(rootBody(PATHS)));
      PATHS.forEach((p) => f.route(`${HOST}${p}`, redirect(`https://sso.example/login?next=${encodeURIComponent(p)}`)));
      const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
      await expectDemoted(id, run.id);
      expect(f.urls().some((u) => u.includes('sso.example'))).toBe(false); // 범위 밖이라 SSO로는 요청하지 않는다.
    });
  });

  describe('(d) 오탐 없음', () => {
    it('★ 서로 다른 정상 페이지 12쪽은 강등되지 않는다(작은 소스에서도)', async () => {
      const id = await seedIngestedSource();
      const run = await h.drive(h.makeRunner({ fetcher: healthySite() }).runner, await h.startRun(id, 'SYNC'));
      expect(run.status).not.toBe('FAILED');
      expect(run.demotedReason).toBeNull();
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBe(1);
      expect(source.reviewRequiredReason).toBeNull();
    });

    it('★ 소수(2쪽)가 우연히 같아도 강등되지 않는다', async () => {
      const id = await seedIngestedSource();
      const f = healthySite();
      f.route(`${HOST}${PATHS[1]}`, html(docBody(1))); // p2가 p1과 같은 본문
      const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
    });

    it('임계(방문 HTML 10쪽) 미만은 모두 같아도 판정하지 않는다 — 8쪽 + 목록 1쪽', async () => {
      const paths = PATHS.slice(0, 8);
      const id = await seedIngestedSource(paths);
      const run = await h.drive(h.makeRunner({ fetcher: loginSite(page('로그인이 필요합니다', paths), paths) }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
    });

    it('★ 여러 문서가 새 도메인의 서로 다른 경로로 이사한 경우(다른 목적지)는 강등되지 않는다', async () => {
      const id = await seedIngestedSource();
      const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n')).route(DOCS, html(rootBody(PATHS)));
      PATHS.forEach((p) => f.route(`${HOST}${p}`, redirect(`https://newdocs.example${p}`)));
      const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBeNull();
    });
  });

  describe('(e) PREVIEW는 강등하지 않고 기록만 한다', () => {
    it('★ 로그인 폼 사이트의 PREVIEW — 실행에 AUTH_WALL을 남기되 소스 승인은 그대로다', async () => {
      const { id } = await h.createSource();
      const run = await h.drive(h.makeRunner({ fetcher: loginSite(page('로그인이 필요합니다', PATHS)) }).runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(run.demotedReason).toBe('AUTH_WALL'); // 미리보기 화면 경고용 기록
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.approvedConfigVersion).toBe(1); // 승인 해제(강등) 없음
      expect(source.reviewRequiredReason).toBeNull();
    });

    it('관측 해시는 방문한 HTML 행마다 남는다(원문이 아니라 해시 값)', async () => {
      const { id } = await h.createSource();
      await h.drive(h.makeRunner({ fetcher: healthySite() }).runner, await h.startRun(id, 'PREVIEW'));
      const rows = await h.prisma.kbDocument.findMany({ where: { sourceId: id } });
      expect(rows).toHaveLength(13);
      expect(rows.every((r) => typeof r.observedHash === 'string' && r.observedHash.length > 0)).toBe(true);
      expect(new Set(rows.map((r) => r.observedHash)).size).toBe(13);
    });
  });

  describe('관측 해시는 실행마다 새로 정한다', () => {
    it('★ 이번 실행에서 다시 재지 않은 행(304 등)은 지난 실행의 관측 해시를 물려받지 않는다', async () => {
      const { id } = await h.createSource();
      await h.drive(h.makeRunner({ fetcher: healthySite() }).runner, await h.startRun(id, 'PREVIEW'));
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, observedHash: { not: null } } })).toBe(13);
      // 다음 실행은 전부 304 — 본문을 다시 받지 않으므로 분포에 아무 행도 남지 않아야 한다(지난 값이 남으면 오래된 분포가 이번 판정에 섞인다).
      const f = new FakeFetcher().route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n'));
      f.route(DOCS, { kind: 'RESPONSE', status: 304, contentType: 'text/html', body: Buffer.alloc(0), headers: {} });
      for (const p of PATHS) f.route(`${HOST}${p}`, { kind: 'RESPONSE', status: 304, contentType: 'text/html', body: Buffer.alloc(0), headers: {} });
      await h.prisma.kbDocument.updateMany({ where: { sourceId: id }, data: { etag: '"e"' } });
      const run = await h.drive(h.makeRunner({ fetcher: f }).runner, await h.startRun(id, 'PREVIEW'));
      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, observedHash: { not: null } } })).toBe(0);
    });
  });

  describe('관측 해시 초기화(seedFrontier)', () => {
    it('이번 실행의 프런티어로 다시 올린 행은 지난 실행의 관측 해시를 비운다(방문 전에 남아 있으면 이번 분포에 섞인다)', async () => {
      const { id } = await h.createSource();
      const url = `${HOST}/docs/reset`;
      const entry = { url, urlHash: urlHash(url), kind: 'HTML', externalFileName: 'kb_00000000_0000000000000000.html', depth: 1 };
      await h.store.seedFrontier(id, 'run-1', [entry]);
      await h.prisma.kbDocument.updateMany({ where: { sourceId: id }, data: { observedHash: 'stale' } });
      await h.store.seedFrontier(id, 'run-2', [entry]);
      const row = await h.prisma.kbDocument.findFirstOrThrow({ where: { sourceId: id } });
      expect(row.seenRunId).toBe('run-2');
      expect(row.observedHash).toBeNull();
    });
  });

  describe('(f) 조각이 여러 번으로 나뉘어도 전체 분포로 판정한다', () => {
    it('★ 요청 3개마다 조각을 끊어도(종결 조각의 방문분은 몇 쪽뿐) 강등된다', async () => {
      const id = await seedIngestedSource();
      const fetcher = loginSite(page('로그인이 필요합니다', PATHS));
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      let fragments = 0;
      for (; fragments < 40; fragments += 1) {
        const current = await h.store.findRun(runId);
        if (current && current.status !== 'QUEUED' && current.status !== 'CRAWLING') break;
        const limit = fetcher.requests.length + 3;
        await h.fragment(runner, runId, { stopping: () => fetcher.requests.length >= limit });
      }
      expect(fragments).toBeGreaterThan(2); // 정말 여러 조각으로 나뉘었다.
      await expectDemoted(id, runId);
    });
  });
});
