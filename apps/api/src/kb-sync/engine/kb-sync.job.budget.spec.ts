import type { ConfigService } from '@nestjs/config';
import { KB_SYNC_LIMITS } from '@chat-bot/shared-types';
import { KbSyncJob } from './kb-sync.job';
import { InProcessExtractor } from '../extract/in-process.extractor';

/**
 * [pass 6 · RG-17 · RG-18] tick의 크롤 예산 분할 · 후보 넉넉히 읽기 — 유닛 시험(저장소·러너는 가짜).
 */
function config(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const sourceRow = (id: string) => ({
  id,
  name: id,
  seedUrls: '[]',
  sitemapUrls: '[]',
  allowedHosts: '["a.example"]',
  pathPrefixes: '[]',
  excludePatterns: '[]',
  noisePatterns: '[]',
  allowQueryUrls: false,
  maxDepth: 3,
  maxPages: 50,
  fileTypes: '[]',
  maxFileBytes: 1,
  minIntervalMs: 500,
  authKind: 'NONE',
  authHeaderName: null,
  authSecretRef: null,
  piiMask: true,
  allowRawFileIngest: false,
});

function makeJob(opts: { runs: Array<{ id: string; sourceId: string; kind: string }>; runFragment: jest.Mock; maxParallel?: number; ingest?: jest.Mock }) {
  const findActiveRunsForCrawl = jest.fn().mockResolvedValue(opts.runs);
  const store = { findActiveRunsForCrawl, findSourceById: jest.fn(async (id: string) => sourceRow(id)) } as never;
  const scheduler = { scheduleDueSources: jest.fn().mockResolvedValue([]) } as never;
  const ingest = opts.ingest ?? jest.fn().mockResolvedValue(false);
  const job = new KbSyncJob(config({ KB_SYNC_ENABLED: true, KB_SYNC_MAX_PARALLEL_SOURCES: opts.maxParallel ?? 2 }), store, scheduler, { runFragment: opts.runFragment } as never, { runFragment: ingest } as never, { now: () => new Date() } as never, new InProcessExtractor());
  return { job, findActiveRunsForCrawl, ingest };
}

describe('KbSyncJob.tick — 크롤 예산 분할과 후보 선택(RG-17 · RG-18)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('★ 크롤 후보를 병렬 상한보다 넉넉히 읽는다(대기 중인 겹침 실행이 앞자리를 막지 않게)', async () => {
    const { job, findActiveRunsForCrawl } = makeJob({ runs: [], runFragment: jest.fn() });
    await job.tick();
    expect(findActiveRunsForCrawl).toHaveBeenCalledTimes(1);
    expect(findActiveRunsForCrawl.mock.calls[0][0]).toBeGreaterThanOrEqual(20);
  });

  it('★ N-11 — 같은 호스트를 쓰는 소스 21개가 앞에 대기해도 뒤의 다른 호스트 실행이 후보에 포함돼 시작한다(후보 창이 20개에 묶여 굶지 않는다)', async () => {
    // 활성 실행은 (소스 등록 상한 = 소스당 동시 실행 1) 최대 50개다 — 앞의 21개는 같은 호스트 겹침으로 시작하지 못하고(false), 22번째만 다른 호스트라 시작한다.
    const all = Array.from({ length: 22 }, (_, i) => ({ id: `r${i + 1}`, sourceId: `s-r${i + 1}`, kind: 'SYNC' }));
    const findActiveRunsForCrawl = jest.fn(async (limit: number) => all.slice(0, limit)); // 저장소는 오래된 순으로 limit개만 돌려준다
    const runFragment = jest.fn(async (r: { id: string }) => r.id === 'r22');
    const store = { findActiveRunsForCrawl, findSourceById: jest.fn(async (id: string) => sourceRow(id)) } as never;
    const job = new KbSyncJob(
      config({ KB_SYNC_ENABLED: true, KB_SYNC_MAX_PARALLEL_SOURCES: 2 }),
      store,
      { scheduleDueSources: jest.fn().mockResolvedValue([]) } as never,
      { runFragment } as never,
      { runFragment: jest.fn().mockResolvedValue(false) } as never,
      { now: () => new Date() } as never,
      new InProcessExtractor(),
    );
    await job.tick();
    expect(runFragment.mock.calls.map((c) => (c[0] as { id: string }).id)).toContain('r22');
  });

  it('N-11 — 후보 읽기 상한은 소스 등록 상한(50) 이상이다(활성 실행이 그보다 많을 수 없다)', async () => {
    const { job, findActiveRunsForCrawl } = makeJob({ runs: [], runFragment: jest.fn() });
    await job.tick();
    expect(findActiveRunsForCrawl.mock.calls[0][0]).toBeGreaterThanOrEqual(KB_SYNC_LIMITS.maxSources);
  });

  it('★ 처리하지 못한(false — 다른 인스턴스가 쥠 · 호스트 겹침 대기) 실행은 병렬 상한에 세지 않고 다음 후보로 넘어간다', async () => {
    const runFragment = jest.fn(async (r: { id: string }) => r.id !== 'r1'); // r1은 시작하지 못한다
    const runs = ['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, sourceId: `s-${id}`, kind: 'SYNC' }));
    const { job } = makeJob({ runs, runFragment, maxParallel: 2 });
    await job.tick();
    expect(runFragment.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['r1', 'r2', 'r3']); // 처리한 2개(r2·r3)에서 멈춘다
  });

  it('★ 크롤 예산을 처리하는 실행 수로 나눠 실행별 조각 기한을 준다 — 적재 몫(5초)은 항상 남긴다', async () => {
    const deadlines: number[] = [];
    const runFragment = jest.fn(async (_r: unknown, _s: unknown, deadline: number) => {
      deadlines.push(deadline);
      return true;
    });
    const runs = ['r1', 'r2'].map((id) => ({ id, sourceId: `s-${id}`, kind: 'SYNC' }));
    const { job } = makeJob({ runs, runFragment, maxParallel: 2 });
    const before = Date.now();
    await job.tick();
    const after = Date.now();
    expect(deadlines).toHaveLength(2);
    const tickBudget = 30_000;
    const crawlEnd = (t: number) => t + tickBudget - 5_000;
    // 첫 실행은 크롤 예산의 절반 · 둘째는 남은 전부(앞 실행이 일찍 끝나 남긴 시간을 이어 쓴다) — 어느 쪽도 적재 몫을 넘지 않는다.
    expect(deadlines[0]).toBeGreaterThanOrEqual(before + 12_000);
    expect(deadlines[0]).toBeLessThanOrEqual(crawlEnd(after) - 12_000);
    expect(deadlines[1]).toBeGreaterThan(deadlines[0]);
    expect(deadlines[1]).toBeLessThanOrEqual(crawlEnd(after));
  });

  it('★ N-5 — 실행이 1개면 기본 설정(병렬 상한 2)에서도 크롤 예산 전체(적재 몫 제외)를 쓴다', async () => {
    const deadlines: number[] = [];
    const runFragment = jest.fn(async (_r: unknown, _s: unknown, deadline: number) => {
      deadlines.push(deadline);
      return true;
    });
    const { job } = makeJob({ runs: [{ id: 'r1', sourceId: 's1', kind: 'SYNC' }], runFragment }); // maxParallel 미지정 = 기본 2
    const before = Date.now();
    await job.tick();
    expect(deadlines[0]).toBeGreaterThanOrEqual(before + 24_000);
    expect(deadlines[0]).toBeLessThanOrEqual(Date.now() + 25_000);
  });

  it('★ N-5 — 남은 후보가 1개뿐이면(앞 후보가 시작하지 못함) 병렬 상한이 2여도 예산 전체를 쓴다', async () => {
    const deadlines: number[] = [];
    const runFragment = jest.fn(async (r: { id: string }, _s: unknown, deadline: number) => {
      if (r.id === 'r1') return false; // r1은 시작하지 못한다(호스트 겹침 대기 등)
      deadlines.push(deadline);
      return true;
    });
    const runs = ['r1', 'r2'].map((id) => ({ id, sourceId: `s-${id}`, kind: 'SYNC' }));
    const { job } = makeJob({ runs, runFragment, maxParallel: 2 });
    const before = Date.now();
    await job.tick();
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toBeGreaterThanOrEqual(before + 24_000);
  });

  it('후보가 병렬 상한 이상이면 예전처럼 상한으로 나눈다(대조)', async () => {
    const deadlines: number[] = [];
    const runFragment = jest.fn(async (_r: unknown, _s: unknown, deadline: number) => {
      deadlines.push(deadline);
      return true;
    });
    const runs = ['r1', 'r2', 'r3'].map((id) => ({ id, sourceId: `s-${id}`, kind: 'SYNC' }));
    const { job } = makeJob({ runs, runFragment, maxParallel: 2 });
    const before = Date.now();
    await job.tick();
    expect(deadlines[0]).toBeLessThanOrEqual(before + 13_000); // 25초의 절반
  });
});
