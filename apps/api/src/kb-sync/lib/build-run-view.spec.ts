import { buildRunView, decideWaitingReason } from './build-run-view';
import type { RunRowForView } from './build-run-view';

const base = { pending: 3, inFlight: 0, pendingBulk: 0, ragReady: true as boolean | null, bulkWindowOpen: true };

describe('decideWaitingReason — 실행 화면 대기 사유(§9.6 · AC-KB4-4)', () => {
  it('외부 RAG가 준비되지 않았으면 RAG_NOT_READY', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', ragReady: false })).toBe('RAG_NOT_READY');
  });

  it('RAG 준비 여부를 아직 모르면(null) 사유를 내지 않는다', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', ragReady: null })).toBeNull();
  });

  it('남은 작업이 전부 BULK이고 시간창 밖이면 BULK_WINDOW', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', pendingBulk: 3, bulkWindowOpen: false })).toBe('BULK_WINDOW');
  });

  it('INCREMENTAL이 섞여 있으면(곧 처리된다) BULK_WINDOW가 아니다', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', pendingBulk: 2, bulkWindowOpen: false })).toBeNull();
  });

  it('RAG 미준비가 시간창보다 우선한다', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', ragReady: false, pendingBulk: 3, bulkWindowOpen: false })).toBe('RAG_NOT_READY');
  });

  it('지금 진행 중인 작업이 있거나 대기 작업이 없거나 적재 중이 아니면 사유가 없다', () => {
    expect(decideWaitingReason({ ...base, status: 'INGESTING', ragReady: false, inFlight: 1 })).toBeNull();
    expect(decideWaitingReason({ ...base, status: 'INGESTING', ragReady: false, pending: 0 })).toBeNull();
    for (const status of ['QUEUED', 'CRAWLING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']) {
      expect(decideWaitingReason({ ...base, status, ragReady: false })).toBeNull();
    }
  });
});

describe('buildRunView — 크롤 집계 기본값 · 대기 사유 연결', () => {
  const run = (over: Partial<RunRowForView>): RunRowForView => ({
    id: 'r1',
    sourceId: 's1',
    sourceName: 'n',
    kind: 'SYNC',
    trigger: 'MANUAL',
    status: 'CRAWLING',
    counts: '{}',
    maxPagesReached: false,
    demotedReason: null,
    failureCode: null,
    resumedCount: 0,
    startedAt: null,
    crawlFinishedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    claimedAt: new Date(),
    ...over,
  });
  const deps = {
    now: new Date(),
    leaseMs: 600_000,
    slotCount: 1,
    countJobsByRun: async () => ({ PENDING: 2 }),
    getEtaInputs: async () => ({ remainingHtmlJobs: 2, remainingFileJobs: 0, recentHtmlAvgSeconds: null, recentFileAvgSeconds: null }),
  };

  it('진행 중(counts가 "{}")이어도 크롤 집계는 계약 모양(0으로 채움)이다', async () => {
    const view = await buildRunView(run({}), deps);
    expect(view.crawl).toEqual({ discovered: 0, visited: 0, unchanged: 0, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 });
    expect(view.waitingReason).toBeNull();
  });

  it('기록된 집계는 그대로 살리고 빠진 키만 채운다 · 손상된 JSON은 0으로', async () => {
    const view = await buildRunView(run({ status: 'SUCCEEDED', counts: JSON.stringify({ discovered: 5, visited: 4, excluded: { ROBOTS: 1 } }) }), deps);
    expect(view.crawl.discovered).toBe(5);
    expect(view.crawl.excluded).toEqual({ ROBOTS: 1 });
    expect(view.crawl.gone).toBe(0);
    expect((await buildRunView(run({ counts: '{손상' }), deps)).crawl.discovered).toBe(0);
  });

  it('[pass 11 · M-A] 진행 중 counts의 엔진 내부 표식(priorActiveIngested · seedReached)은 응답 crawl에 새지 않는다', async () => {
    const view = await buildRunView(run({ counts: JSON.stringify({ priorActiveIngested: 31, seedReached: true, outOfScopeLinks: 2 }) }), deps);
    expect(view.crawl).toEqual({ discovered: 0, visited: 0, unchanged: 0, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 2 });
    expect(JSON.stringify(view)).not.toContain('priorActiveIngested');
  });

  it('적재 중 + RAG 미준비 → waitingReason이 실린다', async () => {
    const view = await buildRunView(run({ status: 'INGESTING' }), { ...deps, waiting: { ragReady: false, bulkWindowOpen: true, pendingBulk: () => 0 } });
    expect(view.waitingReason).toBe('RAG_NOT_READY');
  });
});
