import { ApiException } from '../common/api.exception';
import { KbRunsService } from '../kb-sync/kb-runs.service';
import { InProcessExtractor } from '../kb-sync/extract/in-process.extractor';
import { computeIngestFingerprint, sha256Hex } from '../kb-sync/lib/content-fingerprint';
import { buildExternalFileName, urlHash } from '../kb-sync/lib/external-file-name';
import type { KbFetchResult } from '../kb-sync/crawl/kb-crawl-http.fetcher';
import { FakeFetcher, HOST, createHarness, html, page } from './helpers/kb-crawl-db-harness';
import type { Harness } from './helpers/kb-crawl-db-harness';

/**
 * 지식베이스 크롤링(No.43) 백엔드 pass 11 — R6 리뷰(M-A · M-B)의 재현 시험. 실제 DB(SQLite 마이그레이션 적용) + 실제 저장소·서비스·러너, 네트워크·시간·문서 해석·외부 RAG만 가짜.
 */
const DOCS = `${HOST}/docs/`;
const okRobots = (f: FakeFetcher): FakeFetcher => f.route(`${HOST}/robots.txt`, html('User-agent: *\nAllow: /\n'));
const redirect = (location: string, code = 302): KbFetchResult => ({ kind: 'REDIRECT', status: code, location, headers: {} });
const docBody = (i: number): string => page(`문서 ${i}`, [], `문서 ${i}번의 서로 다른 본문입니다. `.repeat(12));

async function addDoc(h: Harness, sourceId: string, path: string, over: Record<string, unknown> = {}) {
  const url = `${HOST}${path}`;
  return h.prisma.kbDocument.create({
    data: { sourceId, url, urlHash: urlHash(url), kind: 'HTML', externalFileName: buildExternalFileName(sourceId, url, 'html'), seenRunId: 'old-run', visitState: 'VISITED', ...over },
  });
}

/** 이미 적재된 문서의 해시·지문 — 같은 본문이 다시 오면 UNCHANGED로 판정된다. */
async function ingestedFields(body: string) {
  const ex = await new InProcessExtractor().extract({ kind: 'HTML', html: body, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
  const contentHash = sha256Hex(ex.normalizedText);
  const ingestFingerprint = computeIngestFingerprint({ contentHash, format: 'DOCX', piiMask: true, piiMaskMode: 'PARTIAL' });
  return { contentHash, ingestFingerprint, textLength: ex.normalizedText.length, lastIngestedAt: new Date(Date.now() - 3_600_000) };
}

describe('KB pass 11', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness('pass11');
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

  /* ───────────────────────── M-A ───────────────────────── */
  describe('M-A — 새로 비율 분모는 실행 시작 시점 값으로 고정한다(다중 tick 크롤)', () => {
    const existing = Array.from({ length: 31 }, (_, i) => `/docs/d${i + 1}`);
    const fresh = Array.from({ length: 20 }, (_, i) => `/docs/n${i + 1}`);
    const noindexBody = (i: number): string => `<html><head><title>비공개 ${i}</title><meta name="robots" content="noindex"></head><body><main><p>${`비공개 문서 ${i}번 본문입니다. `.repeat(12)}</p></main></body></html>`;

    /** 적재된 ACTIVE 31건 중 앞의 12건은 이번 크롤에서 noindex(EXCLUDED)가 되고, 새 문서 20건이 더 발견된다. */
    async function seed() {
      const { id } = await h.createSource();
      for (const [i, p] of existing.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', [...existing, ...fresh])));
      existing.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(i < 12 ? noindexBody(i + 1) : docBody(i + 1))));
      fresh.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(100 + i))));
      return { id, fetcher };
    }

    it('★ 재현 — 한 tick이면 강등(NEW_RATIO)', async () => {
      const { id, fetcher } = await seed();
      const run = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'SYNC'));
      expect(run.demotedReason).toBe('NEW_RATIO');
    });

    it('★ 재현 — 이전 tick에서 12건이 noindex로 EXCLUDED가 된 뒤 두 tick으로 쪼개도 같은 결과(NEW_RATIO · 분모는 실행 시작 시점 31)', async () => {
      const { id, fetcher } = await seed();
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      // 첫 조각은 12번째 noindex 문서를 받은 직후 멈춘다.
      await h.fragment(runner, runId, { stopping: () => fetcher.hitsOf(`${HOST}/docs/d12`) > 0 });
      const mid = await h.store.findRun(runId);
      expect(mid?.status).toBe('CRAWLING');
      expect(await h.prisma.kbDocument.count({ where: { sourceId: id, state: 'EXCLUDED', excludeReason: 'NOINDEX' } })).toBe(12);
      const run = await h.drive(runner, runId);
      expect(run.demotedReason).toBe('NEW_RATIO');
      expect(run.status).toBe('SUCCEEDED');
      expect(await h.prisma.kbIngestJob.count({ where: { runId } })).toBe(0);
    });

    it('분모는 첫 조각에서 실행 행 counts에 한 번 고정되고, 종결 때 집계가 덮어써 남지 않는다', async () => {
      const { id, fetcher } = await seed();
      const { runner } = h.makeRunner({ fetcher });
      const runId = await h.startRun(id, 'SYNC');
      await h.fragment(runner, runId, { stopping: () => fetcher.hitsOf(`${HOST}/docs/d3`) > 0 });
      expect(JSON.parse((await h.store.findRun(runId))!.counts)).toHaveProperty('priorActiveIngested', 31);
      const run = await h.drive(runner, runId);
      expect(JSON.parse(run.counts)).not.toHaveProperty('priorActiveIngested');
    });
  });

  /* ───────────────────────── L-B ───────────────────────── */
  describe('L-B — 승인은 강등 이후에 끝난 미리보기를 요구한다', () => {
    const makeRuns = () => new KbRunsService(h.prisma, h.config, h.store, h.sourcesService, { record: jest.fn().mockResolvedValue(undefined) } as never, { isConfigured: () => true } as never);
    const existing = Array.from({ length: 20 }, (_, i) => `/docs/d${i + 1}`);
    const fresh = Array.from({ length: 30 }, (_, i) => `/docs/n${i + 1}`);
    const tick = () => new Promise((r) => setTimeout(r, 15));
    const rejection = async (fn: () => Promise<unknown>) => {
      const err = (await fn().catch((e: unknown) => e)) as ApiException;
      expect(err).toBeInstanceOf(ApiException);
      return { status: err.getStatus(), body: err.getResponse() as { code: string; message: string; details?: Array<{ field: string; message: string }> } };
    };

    /** 적재된 ACTIVE 문서 20건. 깨끗한 미리보기 P0을 먼저 끝낸 뒤, 새 문서 30건이 생겨 SYNC가 NEW_RATIO로 강등된다. */
    async function demotedAfterCleanPreview() {
      const { id } = await h.createSource();
      for (const [i, p] of existing.entries()) await addDoc(h, id, p, { ...(await ingestedFields(docBody(i + 1))) });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', existing)));
      existing.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(i + 1))));
      const { runner } = h.makeRunner({ fetcher });
      const p0 = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(p0.status).toBe('SUCCEEDED');
      expect(p0.demotedReason).toBeNull();
      await tick();
      fetcher.route(DOCS, html(page('목록', [...existing, ...fresh])));
      fresh.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(100 + i))));
      const sync = await h.drive(runner, await h.startRun(id, 'SYNC'));
      expect(sync.demotedReason).toBe('NEW_RATIO');
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).reviewRequiredReason).toBe('NEW_RATIO');
      await tick();
      return { id, runner, p0 };
    }

    it('★ 재현 — 강등된 뒤에 옛 성공 미리보기 id로 승인하면 거절된다(KB_INGEST_NOT_ALLOWED · PREVIEW_STALE)', async () => {
      const { id, p0 } = await demotedAfterCleanPreview();
      const { status, body } = await rejection(() => makeRuns().approveIngest(id, { previewRunId: p0.id } as never, 'admin-1'));
      expect(status).toBe(409);
      expect(body.code).toBe('KB_INGEST_NOT_ALLOWED');
      expect(body.details).toEqual([{ field: 'previewRunId', message: 'PREVIEW_STALE' }]);
      expect(body.message).toMatch(/다시 실행/);
      // 승인 기록도 실행도 남지 않는다.
      const source = await h.prisma.kbSource.findUniqueOrThrow({ where: { id } });
      expect(source.activeRunId).toBeNull();
      expect(source.approvedConfigVersion).toBeNull();
      expect(await h.prisma.kbSyncRun.count({ where: { sourceId: id, trigger: 'APPROVAL' } })).toBe(0);
    });

    it('★ 강등 뒤에 새로 끝낸 미리보기로는 승인할 수 있다(그 미리보기가 다시 강등돼도 사람이 그 결과를 본 것이다 — RG-23)', async () => {
      const { id, runner } = await demotedAfterCleanPreview();
      const p2 = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(p2.status).toBe('SUCCEEDED');
      const { runId } = await makeRuns().approveIngest(id, { previewRunId: p2.id } as never, 'admin-1');
      expect((await h.store.findRun(runId))?.trigger).toBe('APPROVAL');
    });

    it('★ 강등 뒤의 미리보기 이후에 다른 실행(강등이 아닌 실패)이 끝났어도(소스의 마지막 실행 ≠ 그 미리보기) 그 미리보기로 승인할 수 있다', async () => {
      const { id, runner } = await demotedAfterCleanPreview();
      const p2 = await h.drive(runner, await h.startRun(id, 'PREVIEW'));
      expect(p2.status).toBe('SUCCEEDED');
      await tick();
      const later = await h.startRun(id, 'PREVIEW'); // 사람이 중지한 실행 — 종료 시각은 남지만 강등이 아니다
      expect(await h.sourcesService.cancelRunAndRelease(id, later, new Date(), 'admin-1', 'CANCELLED_BY_USER')).toBe(true);
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).lastRunId).toBe(later);
      await expect(makeRuns().approveIngest(id, { previewRunId: p2.id } as never, 'admin-1')).resolves.toMatchObject({ runId: expect.any(String) });
    });

    it('대조 — 강등 사유가 없는 소스는 종전대로 성공한 미리보기 id로 승인된다', async () => {
      const { id } = await h.createSource();
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록')));
      const p0 = await h.drive(h.makeRunner({ fetcher }).runner, await h.startRun(id, 'PREVIEW'));
      expect((await h.prisma.kbSource.findUniqueOrThrow({ where: { id } })).reviewRequiredReason).toBeNull();
      await expect(makeRuns().approveIngest(id, { previewRunId: p0.id } as never, 'admin-1')).resolves.toMatchObject({ runId: expect.any(String) });
    });
  });

  /* ───────────────────────── M-B ───────────────────────── */
  describe('M-B — 로그인 리다이렉트의 return 파라미터가 페이지마다 달라도 인증 벽으로 잡는다', () => {
    const olds = Array.from({ length: 12 }, (_, i) => `/docs/p${i + 1}`);
    const loginForm = page('로그인이 필요합니다');
    const nextOf = (p: string): string => encodeURIComponent(p);

    /** 12개 페이지가 모두 로그인 경로로 리다이렉트된다. `mode` = 로그인 URL의 return 파라미터 형태. */
    async function seed(opts: { allowQueryUrls: boolean; mode: 'PER_PAGE' | 'NONE'; formFor?: (p: string) => string; pathPrefixes?: string[] }) {
      const { id } = await h.createSource({ allowQueryUrls: opts.allowQueryUrls, pathPrefixes: opts.pathPrefixes ?? [] });
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', olds)));
      for (const p of olds) {
        const loc = opts.mode === 'PER_PAGE' ? `/login?next=${nextOf(p)}` : '/login';
        fetcher.route(`${HOST}${p}`, redirect(loc));
        fetcher.route(`${HOST}${loc}`, html(opts.formFor ? opts.formFor(p) : loginForm));
      }
      return { id, fetcher };
    }
    const runSync = async (s: { id: string; fetcher: FakeFetcher }) => h.drive(h.makeRunner({ fetcher: s.fetcher }).runner, await h.startRun(s.id, 'SYNC'));

    it('★ (a) 쿼리 허용 + next가 페이지마다 다름 → AUTH_WALL(로그인 폼 12건이 적재 큐에 들어가지 않는다)', async () => {
      const run = await runSync(await seed({ allowQueryUrls: true, mode: 'PER_PAGE' }));
      expect(run.demotedReason).toBe('AUTH_WALL');
      expect(await h.prisma.kbIngestJob.count({ where: { runId: run.id } })).toBe(0);
    });

    it('★ (a2) 쿼리 허용 + next가 페이지마다 다르고 로그인 폼 본문에도 그 값이 들어가 본문 해시가 전부 달라도 AUTH_WALL', async () => {
      const run = await runSync(await seed({ allowQueryUrls: true, mode: 'PER_PAGE', formFor: (p) => page('로그인이 필요합니다', [], `로그인 후 ${p} 로 돌아갑니다. 아이디와 비밀번호를 입력하세요. `.repeat(6)) }));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });

    it('(b) 쿼리 미허용 같은 리다이렉트 → AUTH_WALL(범위 밖 X: 지문)', async () => {
      const run = await runSync(await seed({ allowQueryUrls: false, mode: 'PER_PAGE' }));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });

    it('(c) 쿼리 허용 + next 없음 → AUTH_WALL', async () => {
      const run = await runSync(await seed({ allowQueryUrls: true, mode: 'NONE' }));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });

    it('(d) 쿼리 미허용 + next 없음, 경로 접두가 /login을 포함 → AUTH_WALL', async () => {
      const run = await runSync(await seed({ allowQueryUrls: false, mode: 'NONE', pathPrefixes: ['/docs', '/login'] }));
      expect(run.demotedReason).toBe('AUTH_WALL');
    });

    it('★ 오탐 없음 — 작은 사이트에서 일부(10쪽)만 로그인으로 넘어가고 정상 문서 5건이 있으면 강등하지 않는다(목적지 행은 분모에 이중으로 세지 않되 정상 문서는 센다)', async () => {
      const { id } = await h.createSource({ allowQueryUrls: true, pathPrefixes: [] });
      const priv = olds.slice(0, 10);
      const open = Array.from({ length: 5 }, (_, i) => `/docs/open${i + 1}`);
      const fetcher = okRobots(new FakeFetcher()).route(DOCS, html(page('목록', [...priv, ...open])));
      for (const p of priv) {
        fetcher.route(`${HOST}${p}`, redirect(`/login?next=${nextOf(p)}`));
        fetcher.route(`${HOST}/login?next=${nextOf(p)}`, html(loginForm));
      }
      open.forEach((p, i) => fetcher.route(`${HOST}${p}`, html(docBody(i + 1))));
      const run = await runSync({ id, fetcher });
      expect(run.demotedReason).toBeNull();
    });
  });
});
