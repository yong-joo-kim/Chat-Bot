import type { KbRunView } from '@chat-bot/shared-types';
import { isLeaseExpired } from '../../common/polling/lease';
import { computeEtaSeconds } from './eta';

/**
 * [신규 No.43 — 3차 보완] `KbRunView` 조립(§9.6) — `kb-runs.service.ts`(실행 상세·목록)와
 * `kb-sources.service.ts`(소스 응답의 `activeRun` 요약) 둘 다 같은 로직을 쓴다(etaSeconds 계산
 * 중복·드리프트 방지 — 이전에는 두 곳 모두 `null`로 하드코딩돼 있었다).
 */
export interface RunRowForView {
  id: string;
  sourceId: string;
  sourceName: string;
  kind: string;
  trigger: string;
  status: string;
  counts: string;
  maxPagesReached: boolean;
  demotedReason: string | null;
  failureCode: string | null;
  resumedCount: number;
  startedAt: Date | null;
  crawlFinishedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  claimedAt: Date | null;
}

/** 대기 사유 입력(§9.6) — 없으면 `waitingReason`은 늘 null이다(예: 종결 실행만 다루는 호출). */
export interface WaitingDeps {
  ragReady: boolean | null;
  bulkWindowOpen: boolean;
  pendingBulk(runId: string): number;
}

export interface BuildRunViewDeps {
  now: Date;
  leaseMs: number;
  slotCount: number;
  waiting?: WaitingDeps;
  countJobsByRun(runId: string): Promise<Record<string, number>>;
  getEtaInputs(runId: string): Promise<{ remainingHtmlJobs: number; remainingFileJobs: number; recentHtmlAvgSeconds: number | null; recentFileAvgSeconds: number | null }>;
}

const EMPTY_CRAWL_COUNTS = { discovered: 0, visited: 0, unchanged: 0, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 };

/** 크롤 집계는 종결 때 기록된다 — 진행 중(`{}`)·손상된 값은 0으로 채워 계약(`KbRunCrawlCounts`)을 지킨다. */
function parseCrawlCounts(json: string): KbRunView['crawl'] {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // 계약 필드만 싣는다 — 진행 중 실행의 `counts`에는 엔진 내부 표식(`seedReached` 등)이 함께 있을 수 있다.
    const known: Record<string, unknown> = {};
    for (const key of Object.keys(EMPTY_CRAWL_COUNTS)) if (key in parsed) known[key] = parsed[key];
    return { ...EMPTY_CRAWL_COUNTS, ...known } as KbRunView['crawl'];
  } catch {
    return { ...EMPTY_CRAWL_COUNTS } as KbRunView['crawl'];
  }
}

/**
 * 대기 사유(순수 — §9.6 · AC-KB4-4). 적재 중인데 지금 진행 중인 작업이 없고 대기 작업만 있을 때만 이유를 낸다.
 * `RAG_NOT_READY` = 외부 RAG의 vLLM이 준비되지 않아 제출을 미루는 중 · `BULK_WINDOW` = 남은 작업이 전부 BULK인데
 * 시간창(`KB_INGEST_BULK_WINDOW`) 밖이라 기다리는 중. (`RATE_LIMIT`은 인스턴스 메모리 상태라 표시하지 않는다.)
 */
export function decideWaitingReason(input: { status: string; pending: number; inFlight: number; pendingBulk: number; ragReady: boolean | null; bulkWindowOpen: boolean }): KbRunView['waitingReason'] {
  if (input.status !== 'INGESTING' || input.pending === 0 || input.inFlight > 0) return null;
  if (input.ragReady === false) return 'RAG_NOT_READY';
  if (!input.bulkWindowOpen && input.pendingBulk === input.pending) return 'BULK_WINDOW';
  return null;
}

export async function buildRunView(run: RunRowForView, deps: BuildRunViewDeps): Promise<KbRunView> {
  const displayStatus =
    run.status === 'CRAWLING' && run.claimedAt && isLeaseExpired(run.claimedAt, deps.now, deps.leaseMs) ? ('INTERRUPTED' as const) : (run.status as KbRunView['status']);

  let ingest: KbRunView['ingest'] = null;
  let progress: KbRunView['progress'] = null;
  let etaSeconds: number | null = null;
  let waitingReason: KbRunView['waitingReason'] = null;

  if (run.status === 'INGESTING' || run.status === 'SUCCEEDED' || run.status === 'PARTIAL') {
    const counts = await deps.countJobsByRun(run.id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const succeeded = counts.SUCCEEDED ?? 0;
    const failed = counts.FAILED ?? 0;
    const unknown = counts.UNKNOWN ?? 0;
    const timeout = counts.TIMEOUT ?? 0;
    const cancelled = counts.CANCELLED ?? 0;
    const skipped = counts.SKIPPED ?? 0;
    const pending = counts.PENDING ?? 0;
    const inFlight = (counts.SUBMITTING ?? 0) + (counts.SUBMITTED ?? 0);
    ingest = { total, pending, inFlight, succeeded, failed, unknown, timeout, cancelled, skipped };
    if (deps.waiting) {
      waitingReason = decideWaitingReason({
        status: run.status,
        pending,
        inFlight,
        pendingBulk: deps.waiting.pendingBulk(run.id),
        ragReady: deps.waiting.ragReady,
        bulkWindowOpen: deps.waiting.bulkWindowOpen,
      });
    }
    progress = { done: succeeded + failed + unknown + timeout + cancelled + skipped, total };

    const etaInputs = await deps.getEtaInputs(run.id);
    etaSeconds = computeEtaSeconds({
      remainingHtmlJobs: etaInputs.remainingHtmlJobs,
      remainingFileJobs: etaInputs.remainingFileJobs,
      slotCount: deps.slotCount,
      sampleAverages: { htmlAvgSeconds: etaInputs.recentHtmlAvgSeconds, fileAvgSeconds: etaInputs.recentFileAvgSeconds },
    });
  }

  return {
    id: run.id,
    sourceId: run.sourceId,
    sourceName: run.sourceName,
    kind: run.kind as KbRunView['kind'],
    trigger: run.trigger as KbRunView['trigger'],
    status: displayStatus,
    crawl: parseCrawlCounts(run.counts),
    ingest,
    progress,
    etaSeconds,
    waitingReason,
    maxPagesReached: run.maxPagesReached,
    demotedReason: run.demotedReason as KbRunView['demotedReason'],
    failureCode: run.failureCode as KbRunView['failureCode'],
    resumedCount: run.resumedCount,
    startedAt: run.startedAt,
    crawlFinishedAt: run.crawlFinishedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  };
}
