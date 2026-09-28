import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isLeaseExpired } from '../../common/polling/lease';
import { isShrunk } from '../lib/change-detect';
import { REDIRECT_TARGET_PREFIX, countsTowardConvergence, isRedirectOriginHash } from '../lib/observed-hash';
import type { GovernanceViolation } from '../lib/governance-flags';

/** 실행 중지(`cancelRun`)가 실행 이력에 남기는 사유 — 관리자 중지 · 소스 일시중지 · (pass 8) 거버넌스 규칙 위반으로 적재 제출 직전에 끝냄. */
export type KbRunCancelCode = 'CANCELLED_BY_USER' | 'SOURCE_DISABLED' | GovernanceViolation;

/**
 * ★ `KbDocument`·`KbSyncRun`·`KbIngestJob`·`KbJobLease` 쓰기 유일 파일(No.43, KB-9). 모든 상태 전이는
 * `updateMany` + 영향 행 수(CAS) — 원시 SQL 0. `KbSource` 쓰기는 `kb-sources.service.ts`가 전담한다
 * (이 파일은 `kbSource`를 읽기만 한다).
 */
@Injectable()
export class KbRunStore {
  constructor(private readonly prisma: PrismaService) {}

  /* ───────────────────────── 소스 선점 · 실행 생성 ───────────────────────── */

  async findDueSources(now: Date, limit: number) {
    return this.prisma.kbSource.findMany({
      where: { enabled: true, activeRunId: null, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** [항목 6 · K-5] 현재 CRAWLING 중인 다른 소스들의 허용 호스트 집합 — 호스트가 겹치는 소스는
   * 같은 tick에 새로 시작하지 않는다(§6.8). 인스턴스 메모리가 아니라 DB로 판정해 다중 인스턴스에도
   * 적용된다. */
  async findActiveCrawlHosts(excludeSourceId: string): Promise<Set<string>> {
    const sources = await this.prisma.kbSource.findMany({
      where: { id: { not: excludeSourceId }, activeRunId: { not: null } },
      select: { activeRunId: true, allowedHosts: true },
    });
    if (sources.length === 0) return new Set();
    const runIds = sources.map((s) => s.activeRunId).filter((id): id is string => !!id);
    const crawling = await this.prisma.kbSyncRun.findMany({ where: { id: { in: runIds }, status: 'CRAWLING' }, select: { id: true } });
    const crawlingIds = new Set(crawling.map((r) => r.id));
    const hosts = new Set<string>();
    for (const s of sources) {
      if (!s.activeRunId || !crawlingIds.has(s.activeRunId)) continue;
      try {
        const arr = JSON.parse(s.allowedHosts);
        if (Array.isArray(arr)) for (const h of arr) hosts.add(String(h));
      } catch {
        // 형식 오류 행은 무시(방어적).
      }
    }
    return hosts;
  }

  /** ★ `id`는 호출부가 `KbSource.activeRunId` CAS에 쓴 값과 **반드시 같아야 한다**(그렇지 않으면
   * Prisma가 새 id를 자동 생성해 activeRunId가 존재하지 않는 실행을 가리키게 된다 — 릴리즈 CAS가
   * 영원히 실패). 그래서 `id`를 필수 인자로 받고 `@default(uuid())`에 맡기지 않는다. */
  async createRun(
    data: {
      id: string;
      sourceId: string;
      sourceName: string;
      kind: 'PREVIEW' | 'SYNC' | 'FULL_RESEND';
      trigger: 'SCHEDULED' | 'MANUAL' | 'APPROVAL';
      configVersion: number;
      createdById?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    // [pass 4 · 위반 5] `KbSourcesService.claimAndCreateRun()`이 소스 CAS와 같은 트랜잭션으로 부른다 —
    // `tx`가 있으면 그 트랜잭션 클라이언트로 쓴다.
    return (tx ?? this.prisma).kbSyncRun.create({
      data: {
        id: data.id,
        sourceId: data.sourceId,
        sourceName: data.sourceName,
        kind: data.kind,
        trigger: data.trigger,
        status: 'QUEUED',
        configVersion: data.configVersion,
        createdById: data.createdById ?? null,
      },
    });
  }

  async findRun(id: string) {
    return this.prisma.kbSyncRun.findUnique({ where: { id } });
  }

  /**
   * [pass 11 · L-B] 이 소스의 현재 `reviewRequiredReason`(자동 강등)을 만든 가장 최근 실행의 종료 시각 — 강등이 실제로 소스 승인을 해제한 실행(적재를 만드는 SYNC·FULL_RESEND의 모든 강등 · 미리보기의
   * 새로 비율 강등)만 센다(미리보기의 인증 벽 의심은 기록만 한다). 그런 실행 행이 없으면(보존 기간 정리 등) `null`.
   */
  async findLatestDemotionFinishedAt(sourceId: string): Promise<Date | null> {
    const run = await this.prisma.kbSyncRun.findFirst({
      where: { sourceId, demotedReason: { not: null }, finishedAt: { not: null }, OR: [{ kind: { not: 'PREVIEW' } }, { demotedReason: 'NEW_RATIO' }] },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    return run?.finishedAt ?? null;
  }

  async listRuns(sourceId: string, skip: number, take: number) {
    const [items, total] = await Promise.all([
      this.prisma.kbSyncRun.findMany({ where: { sourceId }, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.kbSyncRun.count({ where: { sourceId } }),
    ]);
    return { items, total };
  }

  async findActiveRunsForCrawl(limit: number) {
    return this.prisma.kbSyncRun.findMany({ where: { status: { in: ['QUEUED', 'CRAWLING'] } }, orderBy: { createdAt: 'asc' }, take: limit });
  }

  async findSourceById(id: string) {
    return this.prisma.kbSource.findUnique({ where: { id } });
  }

  /* ───────────────────────── 크롤 임대 · 상태 전이 ───────────────────────── */

  /** 실행을 크롤 임대로 선점(만료분 회수 포함). 성공하면 claimToken 반환. */
  async claimCrawlLease(runId: string, leaseMs: number, now: Date): Promise<string | null> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    const token = randomUUID();

    if (run.status === 'QUEUED') {
      // [pass 6 · RG-18 · 설계 §25.3 B안] 크롤을 시작하는 순간의 게이트 — 허용 호스트가 겹치는 다른 소스의 CRAWLING 실행이 있거나 더 오래 기다린
      // (생성 순서가 앞선) QUEUED 실행이 있으면 시작하지 않고 QUEUED로 둔다(먼저 만든 실행 우선). 스케줄러·수동 실행·적재 승인 세 경로와 다중
      // 인스턴스가 모두 이 한 곳(DB 판정)에서 같은 규칙을 받는다.
      if ((await this.findHostOverlapBlockers(run, { phase: 'START' })).length > 0) return null;
      const { count } = await this.prisma.kbSyncRun.updateMany({
        where: { id: runId, status: 'QUEUED' },
        data: { status: 'CRAWLING', claimToken: token, claimedAt: now, startedAt: now },
      });
      if (count !== 1) return null;
      // 낙관적 시작 뒤 사후 확인 — 판정과 CAS가 다른 문장이라 두 인스턴스가 동시에 통과할 수 있다. 그 사이 겹치는 다른 실행이 (앞서거나 먼저) 크롤을
      // 시작했으면 QUEUED로 되돌려 다음 tick에 다시 순서를 따른다.
      if ((await this.findHostOverlapBlockers(run, { phase: 'AFTER_START', claimedAt: now })).length > 0) {
        await this.prisma.kbSyncRun.updateMany({
          where: { id: runId, status: 'CRAWLING', claimToken: token },
          data: { status: 'QUEUED', claimToken: null, claimedAt: null, startedAt: null },
        });
        return null;
      }
      return token;
    }
    if (run.status === 'CRAWLING') {
      const expired = !run.claimedAt || isLeaseExpired(run.claimedAt, now, leaseMs);
      if (!expired) return null;
      // [pass 6 · M-7] 읽은 `claimedAt`이 같을 때만 인수한다 — 토큰만 비교하면 읽은 뒤 원래 보유자가 임대를 갱신(토큰 동일 · claimedAt만 전진)했는데도
      // 낚아채는 경합이 남는다.
      const { count } = await this.prisma.kbSyncRun.updateMany({
        where: { id: runId, status: 'CRAWLING', claimToken: run.claimToken, claimedAt: run.claimedAt },
        data: { claimToken: token, claimedAt: now, resumedCount: { increment: 1 } },
      });
      return count === 1 ? token : null;
    }
    return null;
  }

  /**
   * [pass 6 · RG-18 · §25.3 B안] 이 QUEUED 실행의 크롤 시작을 막는 "호스트가 겹치는 다른 소스의 실행" id 목록.
   * - `START`(시작 전 판정): 겹치는 다른 소스의 **CRAWLING** 실행 전부 + 나보다 **먼저 만든**(createdAt · 같으면 id 순) QUEUED 실행.
   * - `AFTER_START`(CAS 뒤 사후 확인): 겹치는 다른 소스의 CRAWLING 실행 중 나보다 먼저 만들었거나(순서 우선), 나보다 먼저 크롤을 시작한(claimedAt이 더 이른) 것.
   *   두 실행이 동시에 통과하면 더 늦게 만든 쪽이 물러나고, 아주 좁은 경합에서는 둘 다 물러났다가 다음 tick에 순서대로 다시 시작한다.
   * 겹침 = 두 소스의 `allowedHosts`가 하나라도 같음. 소스 행이 없거나 허용 호스트가 비면 막지 않는다.
   */
  async findHostOverlapBlockers(run: { id: string; sourceId: string; createdAt: Date }, opts: { phase: 'START' | 'AFTER_START'; claimedAt?: Date }): Promise<string[]> {
    const mine = await this.prisma.kbSource.findUnique({ where: { id: run.sourceId }, select: { allowedHosts: true } });
    if (!mine) return [];
    const myHosts = new Set(safeParseArray(mine.allowedHosts));
    if (myHosts.size === 0) return [];
    const others = await this.prisma.kbSyncRun.findMany({
      where: {
        sourceId: { not: run.sourceId },
        OR: [{ status: 'CRAWLING' }, ...(opts.phase === 'START' ? [{ status: 'QUEUED', createdAt: { lte: run.createdAt } }] : [])],
      },
      select: { id: true, sourceId: true, status: true, createdAt: true, claimedAt: true },
    });
    if (others.length === 0) return [];
    const olderThanMe = (r: { id: string; createdAt: Date }): boolean => r.createdAt.getTime() < run.createdAt.getTime() || (r.createdAt.getTime() === run.createdAt.getTime() && r.id < run.id);
    const candidates = others.filter((r) => {
      if (r.status === 'CRAWLING') {
        if (opts.phase === 'START') return true;
        return olderThanMe(r) || (!!r.claimedAt && !!opts.claimedAt && r.claimedAt.getTime() < opts.claimedAt.getTime());
      }
      return olderThanMe(r); // QUEUED — START 단계에서만 조회된다.
    });
    if (candidates.length === 0) return [];
    const sources = await this.prisma.kbSource.findMany({ where: { id: { in: [...new Set(candidates.map((r) => r.sourceId))] } }, select: { id: true, allowedHosts: true } });
    const overlapping = new Set(sources.filter((s) => safeParseArray(s.allowedHosts).some((h) => myHosts.has(h))).map((s) => s.id));
    return candidates.filter((r) => overlapping.has(r.sourceId)).map((r) => r.id);
  }

  async renewCrawlLease(runId: string, claimToken: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.kbSyncRun.updateMany({ where: { id: runId, claimToken }, data: { claimedAt: now } });
    return count === 1;
  }

  async finishCrawl(
    runId: string,
    data: {
      status: 'INGESTING' | 'SUCCEEDED' | 'FAILED';
      counts: string;
      maxPagesReached: boolean;
      abortedHosts: string;
      demotedReason?: 'NEW_RATIO' | 'AUTH_WALL' | null;
      failureCode?: string | null;
      crawlFinishedAt: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await (tx ?? this.prisma).kbSyncRun.updateMany({
      where: { id: runId, status: 'CRAWLING' },
      data: {
        status: data.status,
        counts: data.counts,
        maxPagesReached: data.maxPagesReached,
        abortedHosts: data.abortedHosts,
        demotedReason: data.demotedReason ?? null,
        failureCode: data.failureCode ?? null,
        crawlFinishedAt: data.crawlFinishedAt,
        claimToken: null,
        ...(data.status !== 'INGESTING' ? { finishedAt: data.crawlFinishedAt } : {}),
      },
    });
    return count === 1;
  }

  async findIngestingRuns(limit: number) {
    return this.prisma.kbSyncRun.findMany({ where: { status: 'INGESTING' }, take: limit });
  }

  async finishIngesting(runId: string, status: 'SUCCEEDED' | 'PARTIAL', finishedAt: Date, tx?: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await (tx ?? this.prisma).kbSyncRun.updateMany({ where: { id: runId, status: 'INGESTING' }, data: { status, finishedAt } });
    return count === 1;
  }

  /**
   * 실행 중지. `failureCode`는 왜 멈췄는지(`CANCELLED_BY_USER` 관리자 중지 · `SOURCE_DISABLED` 소스 일시중지)를 실행 이력에 남긴다.
   * 소스 선점 해제와 한 트랜잭션으로 묶으려면 호출부(`KbSourcesService.cancelRunAndRelease`)가 `tx`를 넘긴다 —
   * 트랜잭션 안에서는 `tx`만 쓴다(SQLite는 연결이 하나라 `this.prisma`를 부르면 교착).
   */
  async cancelRun(runId: string, now: Date, cancelledById: string | null, failureCode: KbRunCancelCode | null = null, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = tx ?? this.prisma;
    const { count } = await db.kbSyncRun.updateMany({
      where: { id: runId, status: { in: ['QUEUED', 'CRAWLING', 'INGESTING'] } },
      data: { status: 'CANCELLED', cancelRequestedAt: now, cancelledById, finishedAt: now, claimToken: null, failureCode },
    });
    if (count === 1) {
      // [pass 4] 중지된 실행의 작업이 (a) 쥐고 있던 적재 슬롯을 놓고 (b) 문서의 "진행 중 적재 1건" 표식을
      // 풀어야 다음 실행이 그 문서를 다시 적재 대상으로 삼을 수 있다(예전에는 둘 다 남아 슬롯은 임대
      // 만료까지, 문서는 영구히 막혔다). 중지는 실패가 아니므로 연속 실패 수는 올리지 않는다.
      const affected = await db.kbIngestJob.findMany({ where: { runId, status: { in: ['PENDING', 'SUBMITTED'] } }, select: { id: true, status: true, slotToken: true } });
      // [pass 6 · RG-20③] 소스 일시중지로 멈춘 작업은 `CONFIG_CHANGED`다 — 소스가 꺼져 있어 제출을 취소하는 기존 경로(`trySubmitOne`의 소스 비활성 판정)와 같은 값.
      // 관리자가 직접 중지한 실행의 작업만 `CANCELLED_BY_USER`.
      await db.kbIngestJob.updateMany({ where: { runId, status: 'PENDING' }, data: { status: 'CANCELLED', resultCode: cancelJobResultCode(failureCode) } });
      await db.kbIngestJob.updateMany({ where: { runId, status: 'SUBMITTED' }, data: { status: 'UNKNOWN', slotToken: null } });
      for (const j of affected) if (j.status === 'SUBMITTED' && j.slotToken) await this.releaseSlot(j.slotToken, tx);
      await this.clearDocumentActiveJobs(affected.map((j) => j.id), tx);
    }
    return count === 1;
  }

  /* ───────────────────────── 문서 프런티어 ───────────────────────── */

  async findDocumentByUrlHash(sourceId: string, urlHash: string) {
    return this.prisma.kbDocument.findUnique({ where: { sourceId_urlHash: { sourceId, urlHash } } });
  }

  /**
   * 링크 발견 배치 등록(§9.3 · 제약⑧ — SQLite `createMany`는 `skipDuplicates`를 지원하지 않아
   * 기존 행 조회 후 신규만 생성한다). 이번 실행에서 아직 보지 못한 기존 행만 갱신한다.
   */
  async seedFrontier(
    sourceId: string,
    runId: string,
    rawEntries: ReadonlyArray<{ url: string; urlHash: string; kind: string; externalFileName: string; depth: number; parentId?: string | null }>,
    /**
     * [pass 7 · N-3] 이번 실행의 프런티어 행 수 상한(`maxPages`) — 넘기면 상한에 닿은 뒤에는 **새 행을 더 넣지 않는다**(이미 넣은 행은 모두 방문한다 · 설계 §9.3). 이미 이번 실행 행인 항목은
     * 새 행이 아니라 세지 않는다. 생략하면 상한 없음(씨앗 넣기는 호출부가 이미 자른다).
     */
    maxRows?: number,
  ): Promise<number> {
    if (rawEntries.length === 0) return 0;
    // [pass 6 · H-1] 같은 `urlHash`(= 정규화 뒤 같은 URL — 예: `/docs/a`와 `/docs/a#intro`)가 한 배치에 둘 이상 들어오면 `createMany`가 유니크 위반(P2002)으로 배치 전체를
    // 잃는다 — 먼저 나온 것(앞선 깊이·발견 순서)만 남긴다. 호출부(`followLinks`)도 거르지만 이 저장소가 마지막 방어선이다.
    const seenHashes = new Set<string>();
    let entries = rawEntries.filter((e) => {
      if (seenHashes.has(e.urlHash)) return false;
      seenHashes.add(e.urlHash);
      return true;
    });
    const existing = await this.prisma.kbDocument.findMany({
      where: { sourceId, urlHash: { in: entries.map((e) => e.urlHash) } },
      select: { id: true, urlHash: true, seenRunId: true },
    });
    const existingByHash = new Map(existing.map((r) => [r.urlHash, r]));
    if (maxRows !== undefined) {
      let room = Math.max(0, maxRows - (await this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId } })));
      entries = entries.filter((e) => {
        const row = existingByHash.get(e.urlHash);
        if (row && row.seenRunId === runId) return true; // 이미 이번 실행의 행 — 새 행이 아니다(아래에서 건너뛴다).
        if (room <= 0) return false;
        room -= 1;
        return true;
      });
      if (entries.length === 0) return 0;
    }
    // [pass 6 · Low-6] 발견 순서 번호는 **소스 전체**의 최대값 다음부터 이어 매긴다(예전에는 이번 배치의 기존 행 최대값만 봐서 신규 행이 낮은 번호를 재사용했다).
    const maxSeq = (await this.prisma.kbDocument.aggregate({ where: { sourceId }, _max: { discoveredSeq: true } }))._max.discoveredSeq ?? 0;
    let seq = maxSeq;
    let added = 0;

    const toCreate = entries.filter((e) => !existingByHash.has(e.urlHash));
    if (toCreate.length > 0) {
      await this.prisma.kbDocument.createMany({
        data: toCreate.map((e) => {
          seq += 1;
          return {
            sourceId,
            url: e.url,
            urlHash: e.urlHash,
            kind: e.kind,
            externalFileName: e.externalFileName,
            seenRunId: runId,
            visitState: 'QUEUED',
            depth: e.depth,
            discoveredSeq: seq,
            discoveredFromId: e.parentId ?? null,
          };
        }),
      });
      added += toCreate.length;
    }

    for (const e of entries) {
      const row = existingByHash.get(e.urlHash);
      if (!row || row.seenRunId === runId) continue;
      seq += 1;
      await this.prisma.kbDocument.updateMany({
        where: { id: row.id },
        // 관측(`observedChange`)은 실행마다 새로 정한다 — 이전 실행의 NEW·CHANGED가 남으면 이번 실행에서
        // 방문하지 못한 행(상한 도달·중지)이 적재 후보로 잘못 잡힌다. 개인정보 건수(`observedPiiMasked`)도 같다(RG-20② — 이번에 다시 재지 않은 행(304·오류·제외)의
        // 지난 실행 값이 실행 요약 합계에 섞이지 않게 한다). 관측 해시(`observedHash` — RG-21 인증 벽 판정)도 같다(이전 실행의 수렴 지문이 이번 분포에 섞이면 안 된다).
        data: { seenRunId: runId, visitState: 'QUEUED', depth: e.depth, discoveredSeq: seq, observedChange: null, observedPiiMasked: null, observedHash: null, discoveredFromId: e.parentId ?? null },
      });
    }
    return added;
  }

  /**
   * [pass 6 · H-2] 이 문서에서 링크로 발견됐던(`discoveredFromId`) 자식들의 URL — 부모가 이번 실행에서 304·오류·차단으로 링크를 다시 확인하지 못했을 때, 지난번에
   * 알던 자식들을 그대로 프런티어에 이어 넣는 데 쓴다(그렇지 않으면 자식이 "다시 발견되지 않음"으로 세어져 연속 2회면 멀쩡한데도 GONE이 되고, 부모가 안 바뀐
   * 사이 바뀐 자식은 영영 다시 방문되지 않는다).
   */
  async findChildDocuments(sourceId: string, parentId: string): Promise<string[]> {
    // [pass 7 · N-7] 삭제(GONE)된 자식은 이어 방문하지 않는다 — 부모가 304일 때마다 이미 사라진 문서를 다시 요청하지 않게. 부모가 다시 그 링크를 내놓으면(200) 일반 발견 경로가
    // 그 행을 QUEUED로 되돌려 방문하고, 200이면 ACTIVE로 복귀한다(RG-10 복귀 규칙). 삭제 카운트 중인 자식(ACTIVE · missingStreak ≥ 1)은 GONE이 되도록 계속 이어 방문한다.
    const rows = await this.prisma.kbDocument.findMany({ where: { sourceId, discoveredFromId: parentId, state: { not: 'GONE' } }, select: { url: true }, orderBy: { discoveredSeq: 'asc' } });
    return rows.map((r) => r.url);
  }

  async nextQueuedDocument(sourceId: string, runId: string) {
    return this.prisma.kbDocument.findFirst({
      where: { sourceId, seenRunId: runId, visitState: 'QUEUED' },
      orderBy: [{ depth: 'asc' }, { discoveredSeq: 'asc' }],
    });
  }

  async countFrontier(sourceId: string, runId: string): Promise<{ visited: number; queued: number; total: number }> {
    const [visited, queued] = await Promise.all([
      this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId, visitState: 'VISITED' } }),
      this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId, visitState: 'QUEUED' } }),
    ]);
    return { visited, queued, total: visited + queued };
  }

  /**
   * 크롤은 여러 tick에 걸쳐 이어질 수 있어(§9.3 · R-5) 조각 실행 사이의 집계(적재 대상·통계)를
   * 프로세스 지역 변수로 들고 있을 수 없다 — `KbDocument` 행 자체가 "이번 실행에서 관측한 결과"의
   * 유일한 진실 소스다. 크롤 종결 시점에 이 두 조회로 다시 모은다.
   */
  async findIngestCandidates(sourceId: string, runId: string): Promise<Array<{ id: string; observedChange: 'NEW' | 'CHANGED' }>> {
    const rows = await this.prisma.kbDocument.findMany({
      where: { sourceId, seenRunId: runId, observedChange: { in: ['NEW', 'CHANGED'] } },
      select: { id: true, observedChange: true },
    });
    return rows.map((r) => ({ id: r.id, observedChange: r.observedChange as 'NEW' | 'CHANGED' }));
  }

  /** [R-21 · EX-KB-4] 이번 실행에서 다시 발견되지 않은(링크·사이트맵 어디에도 없는) 기존 ACTIVE·
   * EXCLUDED 문서 — 삭제 감지의 "NOT_REDISCOVERED" 관측 대상. 호스트 필터는 호출부(중단 호스트
   * 제외)가 한다. */
  async findStaleDocuments(
    sourceId: string,
    runId: string,
    untouchedSince?: Date | null,
  ): Promise<Array<{ id: string; url: string; missingStreak: number; state: 'ACTIVE' | 'GONE' | 'EXCLUDED'; cleanupReason: string | null; lastIngestedAt: Date | null }>> {
    // [pass 5 · RG-5] `untouchedSince`(= 실행 시작 시각) 이후에 바뀐 행은 뺀다 — 종결 도중 실패해 조각이 다시 종결을 시도할 때
    // 이미 이번 실행에서 "다시 발견되지 않음"으로 센 행을 또 세지 않는다(스윕 멱등). 실행 중 다른 경로(적재 성공 등)가 건드린 행도
    // 빠지지만 그것은 세지 않는 쪽(안전측)이다.
    const rows = await this.prisma.kbDocument.findMany({
      where: { sourceId, state: { in: ['ACTIVE', 'EXCLUDED'] }, seenRunId: { not: runId }, ...(untouchedSince ? { updatedAt: { lt: untouchedSince } } : {}) },
      select: { id: true, url: true, missingStreak: true, state: true, cleanupReason: true, lastIngestedAt: true },
    });
    return rows.map((r) => ({ ...r, state: r.state as 'ACTIVE' | 'GONE' | 'EXCLUDED' }));
  }

  async applyMissingUpdate(id: string, next: { missingStreak: number; state: 'ACTIVE' | 'GONE' | 'EXCLUDED'; cleanupReason: string | null }): Promise<void> {
    await this.prisma.kbDocument.update({ where: { id }, data: { missingStreak: next.missingStreak, state: next.state, cleanupReason: next.cleanupReason } });
  }

  /**
   * FULL_RESEND(§9.8) — 해시 무시하고 ACTIVE 문서를 다시 보낸다. [pass 7 · N-2] 대상 = ACTIVE ∧ (한 번이라도 적재했거나(`lastIngestedAt`) 이번 실행에서 콘텐츠가 관측된(`observedChange` NEW·CHANGED·UNCHANGED) 행).
   * 리다이렉트 원본 행(`/docs/a` → `/docs/c`)은 방문 표시만 하고 내용을 관측하지 않으며 적재 단계가 리다이렉트를 따르므로, 대상에 넣으면 같은 내용이 원본·목적지 두 이름으로 중복 적재된다.
   * 304로 확인만 한 문서는 `observedChange`가 없어도 이전에 적재됐으니(`lastIngestedAt`) 계속 대상이다.
   * [pass 9 · M-3] **두 갈래 모두 이번 실행에서 다시 발견·방문한 행(`seenRunId = 실행`)만** 대상이다 — 경로 접두 축소·범위 변경으로 이번에 발견되지 않은 옛 적재 문서(범위 밖)를 외부 RAG로 다시 보내지 않는다(304로 확인된
   * 행도 이번 실행에 방문돼 `seenRunId`가 이번 실행이다). [L-4] 예전에 적재된 뒤 리다이렉트 원본이 된 행(`observedHash`가 `R:`·`RL:`로 시작 — 이번 실행이 방문 표시로 남긴 지문)은 뺀다.
   */
  async findFullResendDocuments(sourceId: string, runId: string): Promise<Array<{ id: string }>> {
    const rows = await this.prisma.kbDocument.findMany({
      where: { sourceId, state: 'ACTIVE', seenRunId: runId, OR: [{ lastIngestedAt: { not: null } }, { observedChange: { in: ['NEW', 'CHANGED', 'UNCHANGED'] } }] },
      select: { id: true, observedHash: true },
    });
    return rows.filter((r) => !isRedirectOriginHash(r.observedHash)).map((r) => ({ id: r.id }));
  }

  async countRunObservations(sourceId: string, runId: string): Promise<{ added: number; changed: number; unchanged: number }> {
    const [added, changed, unchanged] = await Promise.all([
      this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId, observedChange: 'NEW' } }),
      this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId, observedChange: 'CHANGED' } }),
      this.prisma.kbDocument.count({ where: { sourceId, seenRunId: runId, observedChange: 'UNCHANGED' } }),
    ]);
    return { added, changed, unchanged };
  }

  /**
   * [pass 8 · RG-21 · pass 9 · H-1] 인증 벽 판정 입력 — `visited` = 이번 실행에서 **방문한 HTML 행 전체**(304·오류·제외·빈 본문 포함 — 분모), `hashed` = 그중 판정에 쓸 지문(본문 해시 ·
   * `RL:`·`X:`)을 남긴 행 수, `max` = 가장 많이 겹치는 지문의 수. 정상 통합 리다이렉트의 원래 행(`R:`)은 지문을 세지 않는다(분모에는 들어간다). 조각·인스턴스에 걸친 크롤도 DB 행에서 다시 모으므로
   * 실행 전체의 분포다. 파일 행은 `kind = HTML` 조건으로 빠진다.
   */
  async countObservedHashDistribution(sourceId: string, runId: string): Promise<{ visited: number; hashed: number; max: number }> {
    const base = { sourceId, seenRunId: runId, kind: 'HTML', visitState: 'VISITED' } as const;
    // [pass 11 · M-B] 로그인 신호가 있는 목적지에 리다이렉트로 도달한 목적지 행(`RD:`)은 분모에서 뺀다 — 원래 행(`RL:`)이 이미 분자·분모에 세어져 이중으로 부풀지 않는다. `NOT LIKE`는 NULL 행을 함께 떨구므로
    // (SQL 3값 논리) "전체 − RD 행"으로 센다.
    const [visitedAll, redirectTargets, groups] = await Promise.all([
      this.prisma.kbDocument.count({ where: base }),
      this.prisma.kbDocument.count({ where: { ...base, observedHash: { startsWith: REDIRECT_TARGET_PREFIX } } }),
      this.prisma.kbDocument.groupBy({ by: ['observedHash'], where: { ...base, observedHash: { not: null } }, _count: { _all: true } }),
    ]);
    const visited = visitedAll - redirectTargets;
    let hashed = 0;
    let max = 0;
    for (const g of groups) {
      if (!countsTowardConvergence(g.observedHash)) continue;
      hashed += g._count._all;
      if (g._count._all > max) max = g._count._all;
    }
    return { visited, hashed, max };
  }

  /**
   * [pass 4 · 위반 6] 크롤 종결 집계 중 "이번 실행에서 방문한 행"에서 파생되는 값 — 예전에는 종결 때
   * `discovered`·`visited`·`gone`·`excluded` 등을 전부 0으로 써서 실행 요약이 늘 비어 있었다. 조각 실행이 여러
   * tick에 걸쳐도 맞도록 DB 행에서 다시 센다(`seenRunId = 실행`). 삭제 감지 스윕이 이번 실행에서 다시
   * 발견되지 않은 문서(`seenRunId ≠ 실행`)를 바꾼 몫은 호출부가 따로 더한다.
   */
  async countRunOutcomes(
    sourceId: string,
    runId: string,
  ): Promise<{ discovered: number; visited: number; missing: number; gone: number; needsCleanup: number; piiMasked: number; excluded: Record<string, number> }> {
    const seen = { sourceId, seenRunId: runId };
    const [visited, queued, missing, gone, needsCleanup, pii, excludedGroups] = await Promise.all([
      this.prisma.kbDocument.count({ where: { ...seen, visitState: 'VISITED' } }),
      this.prisma.kbDocument.count({ where: { ...seen, visitState: 'QUEUED' } }),
      this.prisma.kbDocument.count({ where: { ...seen, state: 'ACTIVE', missingStreak: { gt: 0 } } }),
      this.prisma.kbDocument.count({ where: { ...seen, state: 'GONE' } }),
      this.prisma.kbDocument.count({ where: { ...seen, cleanupReason: { not: null } } }),
      this.prisma.kbDocument.aggregate({ where: seen, _sum: { observedPiiMasked: true } }),
      this.prisma.kbDocument.groupBy({ by: ['excludeReason'], where: { ...seen, state: 'EXCLUDED', excludeReason: { not: null } }, _count: { _all: true } }),
    ]);
    const excluded: Record<string, number> = {};
    for (const g of excludedGroups) if (g.excludeReason) excluded[g.excludeReason] = g._count._all;
    return { discovered: visited + queued, visited, missing, gone, needsCleanup, piiMasked: pii._sum.observedPiiMasked ?? 0, excluded };
  }

  /**
   * 범위 밖 링크 수(`outOfScopeLinks`)는 행을 만들지 않고 개수만 센다(§6.7) — 행이 없으니 DB에서 다시 셀 수
   * 없어 실행 행의 `counts` JSON에 누적한다(조각 실행이 여러 tick·인스턴스에 걸쳐도 이어진다). 크롤 임대를
   * 쥔 인스턴스 하나만 쓰므로 단순 읽기-수정-쓰기로 충분하다.
   */
  async addOutOfScopeLinks(runId: string, n: number): Promise<void> {
    if (n <= 0) return;
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { counts: true } });
    if (!run) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(run.counts);
    } catch {
      parsed = {};
    }
    const current = typeof parsed.outOfScopeLinks === 'number' ? parsed.outOfScopeLinks : 0;
    await this.prisma.kbSyncRun.updateMany({ where: { id: runId, status: 'CRAWLING' }, data: { counts: JSON.stringify({ ...parsed, outOfScopeLinks: current + n }) } });
  }

  /**
   * [pass 5 · RG-1] 시작 주소(깊이 0) 중 하나라도 응답을 받았다는 표식 — 실행 행 `counts` JSON에 한 번만 기록한다(조각이 여러
   * tick·인스턴스에 걸쳐도 이어진다 — `addOutOfScopeLinks`와 같은 읽기-수정-쓰기, 크롤 임대 보유자 1명만 쓴다). 종결 때 집계가 이
   * 값을 버리고 계약 필드만 다시 쓴다.
   */
  async markSeedReached(runId: string): Promise<void> {
    await this.markSeedFlag(runId, 'seedReached');
  }

  /**
   * [pass 6 · M-8 · RG-20①] 시작 주소(깊이 0) 판정 표식 — `seedReached`(응답을 받음) · `seedFailed`(요청했거나 중단 호스트로 건너뛰었는데 실패) · `seedNeutral`(원본 파일
   * 전달이 꺼져 요청 없이 제외 — 도달도 실패도 아니다). 종결 때 "요청을 보낸 시작 주소가 있고 전부 실패"일 때만 미도달로 본다.
   */
  async markSeedFlag(runId: string, flag: 'seedReached' | 'seedFailed' | 'seedNeutral'): Promise<void> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { counts: true } });
    if (!run) return;
    const parsed = safeParseObject(run.counts);
    if (parsed[flag] === true) return;
    await this.prisma.kbSyncRun.updateMany({ where: { id: runId, status: 'CRAWLING' }, data: { counts: JSON.stringify({ ...parsed, [flag]: true }) } });
  }

  /**
   * [pass 6 · RG-20⑤] 삭제 감지 스윕이 세운 몫(없어짐·GONE·정리 필요)을 실행 행에 남긴다 — 종결 도중 실패해 조각이 다시 종결할 때 이미 스윕한 행은 `untouchedSince`로
   * 빠지므로, 두 번째 종결 요약의 건수가 줄지 않도록 첫 번째 몫을 이어받아 스윕을 다시 하지 않는다.
   */
  async saveSweepCounts(runId: string, sweep: { missing: number; gone: number; needsCleanup: number }): Promise<void> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { counts: true } });
    if (!run) return;
    await this.prisma.kbSyncRun.updateMany({ where: { id: runId, status: 'CRAWLING' }, data: { counts: JSON.stringify({ ...safeParseObject(run.counts), sweep }) } });
  }

  /** [pass 5 · RG-4] 이번 실행에서 수집을 중단한 호스트를 실행 행에 남긴다 — 조각(tick)·인스턴스가 바뀌어도 이어받고, 종결 때 그대로 기록된다. */
  async addAbortedHost(runId: string, host: string): Promise<void> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { abortedHosts: true } });
    if (!run) return;
    const hosts = safeParseArray(run.abortedHosts);
    if (hosts.includes(host)) return;
    await this.prisma.kbSyncRun.updateMany({ where: { id: runId, status: 'CRAWLING' }, data: { abortedHosts: JSON.stringify([...hosts, host]) } });
  }

  /** 스코프 3단이 바뀌면(§9.8 · Q-4 · K-9) 이전에 적재된 ACTIVE 문서에 `SCOPE_CHANGED`를 단다 — 같은 파일 이름을
   * 다른 스코프로 다시 넣을 때 외부의 옛 스코프 청크가 어떻게 되는지 확인되지 않았다. 이미 다른 정리 사유가
   * 있는 문서는 건드리지 않는다. */
  async markScopeChanged(sourceId: string): Promise<number> {
    const { count } = await this.prisma.kbDocument.updateMany({
      where: { sourceId, state: 'ACTIVE', lastIngestedAt: { not: null }, cleanupReason: null },
      data: { cleanupReason: 'SCOPE_CHANGED' },
    });
    return count;
  }

  /**
   * "실행 전 ACTIVE·적재된 문서 수"(§8.4 새로 비율 가드의 분모). [pass 10 · RG-23] 상태가 ACTIVE인 행만 센다 — 사라져 GONE이 된 옛 URL·제외된 URL이 분모를 부풀려
   * 판정을 흐리지 않게 한다(설계 §8.4 문언).
   */
  async countPreviouslyIngested(sourceId: string): Promise<number> {
    return this.prisma.kbDocument.count({ where: { sourceId, state: 'ACTIVE', lastIngestedAt: { not: null } } });
  }

  /**
   * [pass 11 · M-A] 새로 비율 가드의 분모를 **실행 시작 시점 값으로 고정**해 돌려준다(설계 §8.4 "실행 전 ACTIVE·적재됨"). 조각이 여러 tick에 걸치면 tick마다 다시 세는 값은 이 실행이 앞선 tick에서
   * EXCLUDED(noindex·NO_BODY·robots·크기 초과)·GONE으로 바꾼 문서만큼 줄어 가드가 꺼졌다. 첫 조각이 실행 행의 `counts` JSON(`priorActiveIngested`)에 한 번 기록하고 이후 조각·인스턴스는 그 값을 읽는다
   * (새 컬럼 없음 · 종결 때 계약 필드만 다시 써 값이 남지 않고 조회 응답 `parseCrawlCounts`는 계약 키만 싣는다). 실행 행이 없거나 이미 종결돼 기록하지 못하면 지금 센 값을 그대로 돌려준다.
   */
  async fixPriorActiveIngested(sourceId: string, runId: string): Promise<number> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { counts: true } });
    const parsed = run ? safeParseObject(run.counts) : {};
    if (typeof parsed.priorActiveIngested === 'number') return parsed.priorActiveIngested;
    const n = await this.countPreviouslyIngested(sourceId);
    if (run) await this.prisma.kbSyncRun.updateMany({ where: { id: runId, status: 'CRAWLING' }, data: { counts: JSON.stringify({ ...parsed, priorActiveIngested: n }) } });
    return n;
  }

  /**
   * [pass 10 · RG-23] 상태와 무관하게 이 소스가 한 번이라도 적재한 적이 있는가 — "첫 적재"(대량 레인) 판정용. 분모(`countPreviouslyIngested`)를 ACTIVE로 좁혀도 이 판정은
   * 종전(적재 이력 전체) 그대로 둔다 — 문서가 전부 GONE이 됐다고 해서 외부 RAG에 이미 있는 소스를 "처음"으로 보지 않는다.
   */
  async hasEverIngested(sourceId: string): Promise<boolean> {
    return (await this.prisma.kbDocument.count({ where: { sourceId, lastIngestedAt: { not: null } }, take: 1 })) > 0;
  }

  async markVisited(
    id: string,
    data: {
      state: 'ACTIVE' | 'GONE' | 'EXCLUDED';
      excludeReason?: string | null;
      cleanupReason?: string | null;
      missingStreak: number;
      title?: string | null;
      observedChange?: 'NEW' | 'CHANGED' | 'UNCHANGED' | null;
      observedPiiMasked?: number | null;
      /** [pass 8 · RG-21] 이 방문이 관측한 수렴 지문(본문 해시 · `R:`/`X:` 접두). 생략하면 null — 관측하지 못한 행(304·오류·파일)은 인증 벽 분포에서 빠진다. */
      observedHash?: string | null;
      etag?: string | null;
      lastModified?: string | null;
    },
  ): Promise<void> {
    await this.prisma.kbDocument.update({
      where: { id },
      data: {
        visitState: 'VISITED',
        state: data.state,
        excludeReason: data.excludeReason ?? null,
        // `undefined` = 그대로 · `null` = 해제(복귀한 페이지의 GONE 표시 — RG-10) · 문자열 = 그 값.
        cleanupReason: data.cleanupReason,
        missingStreak: data.missingStreak,
        title: data.title ?? undefined,
        observedChange: data.observedChange ?? null,
        observedPiiMasked: data.observedPiiMasked ?? undefined,
        observedHash: data.observedHash ?? null,
        // R-24 — 호출부가 UNCHANGED로 확인했을 때만 이 두 필드를 넘긴다(그 밖에는 undefined = 미변경).
        etag: data.etag === undefined ? undefined : data.etag,
        lastModified: data.lastModified === undefined ? undefined : data.lastModified,
        lastSeenAt: new Date(),
      },
    });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.prisma.kbDocument.delete({ where: { id } }).catch(() => undefined);
  }

  async listDocuments(sourceId: string, where: Record<string, unknown>, skip: number, take: number) {
    const [items, total] = await Promise.all([
      this.prisma.kbDocument.findMany({ where: { sourceId, ...where }, orderBy: { lastSeenAt: 'desc' }, skip, take }),
      this.prisma.kbDocument.count({ where: { sourceId, ...where } }),
    ]);
    return { items, total };
  }

  async countNeedsCleanup(sourceId: string): Promise<number> {
    return this.prisma.kbDocument.count({ where: { sourceId, cleanupReason: { not: null } } });
  }

  async countRepeatedFailures(sourceId: string): Promise<number> {
    return this.prisma.kbDocument.count({ where: { sourceId, consecutiveIngestFailures: { gte: 3 } } });
  }

  /** [R1 리뷰 M-1] `countNeedsCleanup` 배치판 — 목록 조회의 N+1 방지(소스별 개별 count 대신 groupBy 1회). */
  async countNeedsCleanupBatch(sourceIds: readonly string[]): Promise<Map<string, number>> {
    if (sourceIds.length === 0) return new Map();
    const groups = await this.prisma.kbDocument.groupBy({ by: ['sourceId'], where: { sourceId: { in: [...sourceIds] }, cleanupReason: { not: null } }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.sourceId, g._count._all]));
  }

  /** [R1 리뷰 M-1] `countRepeatedFailures` 배치판. */
  async countRepeatedFailuresBatch(sourceIds: readonly string[]): Promise<Map<string, number>> {
    if (sourceIds.length === 0) return new Map();
    const groups = await this.prisma.kbDocument.groupBy({ by: ['sourceId'], where: { sourceId: { in: [...sourceIds] }, consecutiveIngestFailures: { gte: 3 } }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.sourceId, g._count._all]));
  }

  /**
   * [신규 No.43 — R1 M-1 계약 보완] 소스별 "가장 최근에 성공한 PREVIEW 실행"의 configVersion —
   * configVersion은 절대 줄지 않으므로(수정 시 `increment: 1`만 함) MAX(configVersion)이 시간상
   * 가장 늦은 성공 PREVIEW 실행의 configVersion과 같다(그래서 "최신 행 1개"를 따로 조회하지 않고
   * groupBy 1회의 `_max`로 배치 처리할 수 있다 — N+1 방지, `previewStale` 필드·`approve-ingest`
   * 검증이 공유하는 기준).
   */
  async latestSuccessfulPreviewConfigVersions(sourceIds: readonly string[]): Promise<Map<string, number>> {
    if (sourceIds.length === 0) return new Map();
    const groups = await this.prisma.kbSyncRun.groupBy({
      by: ['sourceId'],
      where: { sourceId: { in: [...sourceIds] }, kind: 'PREVIEW', status: 'SUCCEEDED' },
      _max: { configVersion: true },
    });
    const out = new Map<string, number>();
    for (const g of groups) if (g._max.configVersion !== null) out.set(g.sourceId, g._max.configVersion);
    return out;
  }

  async deleteDocumentsForSource(sourceId: string): Promise<void> {
    await this.prisma.kbDocument.deleteMany({ where: { sourceId } });
  }

  /** `FULL_RESEND { acknowledgeCleanup: true }`(§9.8) — 시작 전 GONE 행 삭제 + 정리 표시 해제. */
  async applyCleanupAcknowledge(sourceId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.kbDocument.deleteMany({ where: { sourceId, state: 'GONE' } });
    await db.kbDocument.updateMany({ where: { sourceId, cleanupReason: { not: null } }, data: { cleanupReason: null } });
  }

  /* ───────────────────────── 적재 작업 ───────────────────────── */

  async createIngestJobsBulk(
    jobs: ReadonlyArray<{ runId: string; sourceId: string; documentId: string; lane: 'INCREMENTAL' | 'BULK'; reason: 'NEW' | 'CHANGED' | 'FULL_RESEND' }>,
  ): Promise<number> {
    if (jobs.length === 0) return 0;
    // 문서당 진행 중 적재 1건(CAS) — 이미 진행 중인 문서는 건너뛴다.
    let created = 0;
    for (const j of jobs) {
      const doc = await this.prisma.kbDocument.findUnique({ where: { id: j.documentId }, select: { activeIngestJobId: true } });
      if (!doc || doc.activeIngestJobId) continue;
      const job = await this.prisma.kbIngestJob.create({ data: { runId: j.runId, sourceId: j.sourceId, documentId: j.documentId, lane: j.lane, reason: j.reason } });
      await this.prisma.kbDocument.updateMany({ where: { id: j.documentId, activeIngestJobId: null }, data: { activeIngestJobId: job.id } });
      created += 1;
    }
    return created;
  }

  async countJobsByRun(runId: string): Promise<Record<string, number>> {
    const batch = await this.countJobsByRunBatch([runId]);
    return batch.get(runId) ?? {};
  }

  /** [R1 리뷰 M-1] `countJobsByRun` 배치판 — 실행 목록 조회의 N+1 방지(실행별 개별 groupBy 대신 1회). */
  async countJobsByRunBatch(runIds: readonly string[]): Promise<Map<string, Record<string, number>>> {
    if (runIds.length === 0) return new Map();
    const groups = await this.prisma.kbIngestJob.groupBy({ by: ['runId', 'status'], where: { runId: { in: [...runIds] } }, _count: { _all: true } });
    const out = new Map<string, Record<string, number>>();
    for (const g of groups) {
      const rec = out.get(g.runId) ?? {};
      rec[g.status] = g._count._all;
      out.set(g.runId, rec);
    }
    return out;
  }

  /** 최근 성공 작업(최대 20건씩, HTML/파일 분리)의 평균 소요(제출→완료, 초) — 실행 목록 전체에서
   * 공통으로 쓰는 전역 표본이라(특정 실행에 매이지 않음) 배치 호출 1회로 캐시해 재사용한다. */
  private async recentIngestDurationSamples(): Promise<{ recentHtmlAvgSeconds: number | null; recentFileAvgSeconds: number | null }> {
    const recentSucceeded = await this.prisma.kbIngestJob.findMany({
      where: { status: 'SUCCEEDED', submittedAt: { not: null }, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 60, // 종류별 최근 20건씩을 뽑기 위해 넉넉히 가져온다(성공 작업이 한쪽 종류에 몰릴 수 있어서).
      select: { fileKind: true, submittedAt: true, completedAt: true },
    });
    const htmlDurations: number[] = [];
    const fileDurations: number[] = [];
    for (const j of recentSucceeded) {
      if (!j.submittedAt || !j.completedAt) continue;
      const seconds = (j.completedAt.getTime() - j.submittedAt.getTime()) / 1000;
      if (seconds < 0) continue;
      if (j.fileKind === 'HTML' && htmlDurations.length < 20) htmlDurations.push(seconds);
      else if (j.fileKind && j.fileKind !== 'HTML' && fileDurations.length < 20) fileDurations.push(seconds);
    }
    const avg = (arr: number[]): number | null => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return { recentHtmlAvgSeconds: avg(htmlDurations), recentFileAvgSeconds: avg(fileDurations) };
  }

  /**
   * [신규 No.43 — 3차 보완 · §9.6] 이 실행에 남은 적재 작업(HTML/파일 분리) + 최근 성공 작업의 평균
   * 소요(초) — `eta.ts`의 `computeEtaSeconds()` 입력값. 큐에 남은 작업은 아직 `fileKind`가 안 채워져
   * 있을 수 있어(제출 시점에만 기록) 그 경우에만 문서의 `kind`로 보충 조회한다.
   */
  async getEtaInputs(runId: string): Promise<{ remainingHtmlJobs: number; remainingFileJobs: number; recentHtmlAvgSeconds: number | null; recentFileAvgSeconds: number | null }> {
    const batch = await this.getEtaInputsBatch([runId]);
    return batch.get(runId) ?? { remainingHtmlJobs: 0, remainingFileJobs: 0, recentHtmlAvgSeconds: null, recentFileAvgSeconds: null };
  }

  /** [R1 리뷰 M-1] `getEtaInputs` 배치판 — 실행 목록 조회의 N+1 방지. 남은 작업 집계는 실행 전체를
   * 한 번에 묶어 조회하고(문서 kind 보충 조회도 배치 전체에서 1회), 최근 성공 표본은 전역이라 목록
   * 전체에서 딱 1번만 구해 모든 실행이 공유한다. */
  async getEtaInputsBatch(
    runIds: readonly string[],
  ): Promise<Map<string, { remainingHtmlJobs: number; remainingFileJobs: number; recentHtmlAvgSeconds: number | null; recentFileAvgSeconds: number | null }>> {
    if (runIds.length === 0) return new Map();

    const pendingJobs = await this.prisma.kbIngestJob.findMany({
      where: { runId: { in: [...runIds] }, status: { in: ['PENDING', 'SUBMITTING', 'SUBMITTED'] } },
      select: { runId: true, documentId: true, fileKind: true },
    });
    const remainingByRun = new Map<string, { html: number; file: number }>();
    const unknownPairs: Array<{ runId: string; documentId: string }> = [];
    for (const j of pendingJobs) {
      const rec = remainingByRun.get(j.runId) ?? { html: 0, file: 0 };
      if (j.fileKind === 'HTML') rec.html += 1;
      else if (j.fileKind) rec.file += 1;
      else unknownPairs.push({ runId: j.runId, documentId: j.documentId });
      remainingByRun.set(j.runId, rec);
    }
    if (unknownPairs.length > 0) {
      const docIds = [...new Set(unknownPairs.map((p) => p.documentId))];
      const docs = await this.prisma.kbDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, kind: true } });
      const kindById = new Map(docs.map((d) => [d.id, d.kind]));
      for (const p of unknownPairs) {
        const rec = remainingByRun.get(p.runId) ?? { html: 0, file: 0 };
        if (kindById.get(p.documentId) === 'HTML') rec.html += 1;
        else rec.file += 1;
        remainingByRun.set(p.runId, rec);
      }
    }

    const { recentHtmlAvgSeconds, recentFileAvgSeconds } = await this.recentIngestDurationSamples();

    const out = new Map<string, { remainingHtmlJobs: number; remainingFileJobs: number; recentHtmlAvgSeconds: number | null; recentFileAvgSeconds: number | null }>();
    for (const runId of runIds) {
      const rec = remainingByRun.get(runId) ?? { html: 0, file: 0 };
      out.set(runId, { remainingHtmlJobs: rec.html, remainingFileJobs: rec.file, recentHtmlAvgSeconds, recentFileAvgSeconds });
    }
    return out;
  }

  /**
   * 작업 선택(§9.4) — INCREMENTAL 먼저, 그다음 BULK. `bulkAllowed`가 false(`KB_INGEST_BULK_WINDOW`
   * 시간창 밖)이면 BULK는 고르지 않는다(INCREMENTAL은 항상). 기본값 true = 시간창 미설정과 같다.
   */
  async pickNextPendingJob(now: Date, bulkAllowed = true) {
    // [pass 7 · N-8] 아직 크롤 중(QUEUED·CRAWLING)인 실행의 작업은 후보가 아니다 — 크롤 종결 창(작업 생성 ~ INGESTING 전이)의 작업이나 그 창에서 크롤 인스턴스가 죽어 남은 작업이
    // 가장 오래된 후보로 앞자리를 막아 다른 실행의 적재를 멈추는 것을 막는다. 종단 실행(취소 등)의 고아 작업은 여전히 골라 정리한다(`runGate` — RG-19). 순서(먼저 만든 작업 우선)는 그대로다.
    const crawling = await this.prisma.kbSyncRun.findMany({ where: { status: { in: ['QUEUED', 'CRAWLING'] } }, select: { id: true } });
    const notCrawling = crawling.length > 0 ? { runId: { notIn: crawling.map((r) => r.id) } } : {};
    const incremental = await this.prisma.kbIngestJob.findFirst({
      where: { status: 'PENDING', lane: 'INCREMENTAL', ...notCrawling, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
    });
    if (incremental) return incremental;
    if (!bulkAllowed) return null;
    return this.prisma.kbIngestJob.findFirst({
      where: { status: 'PENDING', lane: 'BULK', ...notCrawling, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findJob(id: string) {
    return this.prisma.kbIngestJob.findUnique({ where: { id } });
  }

  async claimJobForSubmission(id: string, slotToken: string): Promise<boolean> {
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SUBMITTING', slotToken, attemptCount: { increment: 1 } } });
    return count === 1;
  }

  async markSubmitted(id: string, slotToken: string, taskId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: 'SUBMITTING', slotToken }, data: { status: 'SUBMITTED', taskId, submittedAt: now, lastPolledAt: now } });
    return count === 1;
  }

  /**
   * 조회 시각 기록 + **적재 슬롯 임대 연장**(§9.4 — 슬롯은 작업이 종단 상태가 될 때까지 유지되므로 SUBMITTED로
   * 최대 3시간 걸리는 동안 임대가 만료되지 않게 조회 때마다 연장한다). `lastPolledAt`은 다음 조회
   * 시각의 기준이라 호출부가 429 미룸을 위해 미래 시각을 넘길 수도 있다 — 슬롯 연장은 항상 `now`다.
   */
  async markPolled(id: string, lastPolledAt: Date, now: Date = lastPolledAt): Promise<void> {
    const slotKey = await this.slotKeyOf(id);
    await this.prisma.kbIngestJob.updateMany({ where: { id }, data: { lastPolledAt } });
    if (slotKey) await this.renewSlot(slotKey, now);
  }

  async markSkipped(id: string, resultCode: string): Promise<void> {
    // 건너뜀은 실패가 아니다 — 문서의 연속 실패 수를 올리지 않는다(예전엔 올렸다: 변경 없음 건너뜀이
    // 3번 쌓이면 "반복 실패" 배지가 떴다).
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: { in: ['PENDING', 'SUBMITTING'] } }, data: { status: 'SKIPPED', resultCode, slotToken: null } });
    if (count === 1) {
      await this.releaseDocumentActiveJob(id, false);
      if (slotKey) await this.releaseSlot(slotKey);
    }
  }

  async retryJob(id: string, fromStatus: 'SUBMITTING' | 'SUBMITTED', nextAttemptAt: Date, resultCode: string): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: fromStatus }, data: { status: 'PENDING', nextAttemptAt, resultCode, slotToken: null } });
    if (count === 1 && slotKey) await this.releaseSlot(slotKey); // 백오프로 PENDING에 돌아가면 슬롯을 놓는다(§9.4).
    return count === 1;
  }

  /**
   * [신규 No.43 — R2 리뷰 신규 Medium] 제출 시도 자체가 무효였던 경우(예: `WorkerEntryMissingError`
   * — 추출조차 못 해 외부 RAG 호출 이전 단계에서 끝났다) — `claimJobForSubmission`이 걸어 둔
   * `attemptCount` 증가를 상쇄하며 백오프 없이 즉시 PENDING으로 되돌린다("시도"로 치지 않는다).
   */
  async revertSubmissionClaim(id: string, fromStatus: 'SUBMITTING'): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({
      where: { id, status: fromStatus },
      data: { status: 'PENDING', slotToken: null, nextAttemptAt: null, attemptCount: { decrement: 1 } },
    });
    if (count === 1 && slotKey) await this.releaseSlot(slotKey);
    return count === 1;
  }

  /**
   * [신규 No.43 — R2 리뷰 신규 Medium · §9.4] SUBMITTING에 멈춰 있는 작업 방어선 — 프로세스 크래시
   * 등 어떤 이유로든 제출이 끝나지 못한 채 남을 수 있다(`WorkerEntryMissingError`는 코드 경로에서
   * 직접 되돌리지만, 그 밖의 예기치 못한 중단까지 여기서 잡는다). 이 작업이 쥔 전역 직렬 슬롯
   * (`slotToken`이 가리키는 `KbJobLease` 행)의 임대가 만료됐을 때만 손댄다 — 크롤 임대·다른 소스
   * 응답 계산과 같은 판정 함수(`isLeaseExpired`)를 그대로 쓴다.
   *
   * `recordSubmissionMeta`(→ `externalFileName` 등 기록)는 외부 RAG 호출(`ragClient.ingest()`)
   * **바로 직전**에만 실행된다 — 그래서 그 필드가 비어 있으면 크래시가 전송 시도보다 먼저 일어난
   * 것이 확실해 attemptCount를 소모하지 않고 PENDING으로 되돌린다. 이미 채워져 있으면 실제 전송을
   * 시도했을 수 있어(응답 처리 전 크래시) 재시도(중복 적재 위험)하지 않고 `UNKNOWN`으로 종결한다
   * (§9.5 — `cancelRun`의 SUBMITTED→UNKNOWN과 같은 취급).
   */
  async sweepExpiredSubmittingJobs(leaseMs: number, now: Date): Promise<{ revertedToPending: number; markedUnknown: number }> {
    const submitting = await this.prisma.kbIngestJob.findMany({
      where: { status: 'SUBMITTING' },
      select: { id: true, slotToken: true, externalFileName: true },
    });
    if (submitting.length === 0) return { revertedToPending: 0, markedUnknown: 0 };

    const slotNames = [...new Set(submitting.map((j) => (j.slotToken ? this.parseSlotKey(j.slotToken)?.name ?? null : null)).filter((n): n is string => !!n))];
    const leases = slotNames.length > 0 ? await this.prisma.kbJobLease.findMany({ where: { name: { in: slotNames } } }) : [];
    const leaseByName = new Map(leases.map((l) => [l.name, l]));

    let revertedToPending = 0;
    let markedUnknown = 0;
    for (const j of submitting) {
      const parsedSlot = j.slotToken ? this.parseSlotKey(j.slotToken) : null;
      const lease = parsedSlot ? leaseByName.get(parsedSlot.name) : undefined;
      // 슬롯 정보가 없거나(비정상) 그 슬롯의 임대 자체가 이미 사라졌거나, 다른 토큰이 가져갔으면(이 작업을
      // 쥔 보유자는 이미 슬롯을 잃었다) 더 멈춰 있을 이유가 없다 — 이 작업도 멈춘 것으로 본다.
      const expired = !parsedSlot || !lease || !lease.claimToken || lease.claimToken !== parsedSlot.token || !lease.claimedAt || isLeaseExpired(lease.claimedAt, now, leaseMs);
      if (!expired) continue;

      if (!j.externalFileName) {
        if (await this.revertSubmissionClaim(j.id, 'SUBMITTING')) revertedToPending += 1;
      } else {
        const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id: j.id, status: 'SUBMITTING' }, data: { status: 'UNKNOWN', slotToken: null } });
        if (count === 1) {
          markedUnknown += 1;
          await this.clearDocumentActiveJobs([j.id]);
        }
      }
    }
    return { revertedToPending, markedUnknown };
  }

  /** 외부 RAG 재시작으로 `not_found` — 1회에 한해 같은 파일 이름으로 다시 보내도록 PENDING으로 되돌린다(§5.6).
   * 재전송 뒤 또 `not_found`이면 `notFoundResubmitted`가 이미 true라 이 CAS가 실패하고 호출부가 FAILED로 끝낸다. */
  async resubmitNotFound(id: string, nextAttemptAt: Date = new Date()): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({
      where: { id, status: 'SUBMITTED', notFoundResubmitted: false },
      data: { status: 'PENDING', notFoundResubmitted: true, nextAttemptAt, slotToken: null },
    });
    if (count === 1 && slotKey) await this.releaseSlot(slotKey);
    return count === 1;
  }

  async failJob(id: string, fromStatus: 'SUBMITTING' | 'SUBMITTED', resultCode: string, httpStatus?: number, now: Date = new Date()): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({
      where: { id, status: fromStatus },
      data: { status: 'FAILED', resultCode, httpStatus: httpStatus ?? null, completedAt: now, slotToken: null },
    });
    if (count === 1) {
      await this.releaseDocumentActiveJob(id, true);
      if (slotKey) await this.releaseSlot(slotKey);
    }
    return count === 1;
  }

  async timeoutJob(id: string, now: Date = new Date()): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'TIMEOUT', slotToken: null, completedAt: now } });
    if (count === 1) {
      await this.releaseDocumentActiveJob(id, true);
      if (slotKey) await this.releaseSlot(slotKey);
    }
    return count === 1;
  }

  /** 제출 직전(재수집·해석 완료 시점) 계산된 값을 작업 행에 미리 적어 둔다 — 완료 확인이 다른
   * 인스턴스·다음 tick에서 일어나도(재시작 포함) 문서 갱신에 필요한 값을 다시 계산하지 않는다. */
  async recordSubmissionMeta(
    id: string,
    data: { externalFileName: string; contentHash: string; ingestFingerprint: string; textLength: number; byteSize: number; fileKind: string; piiMaskedCount?: number | null },
  ): Promise<void> {
    await this.prisma.kbIngestJob.updateMany({
      where: { id },
      data: {
        externalFileName: data.externalFileName,
        contentHash: data.contentHash,
        ingestFingerprint: data.ingestFingerprint,
        textLength: data.textLength,
        byteSize: data.byteSize,
        fileKind: data.fileKind,
        piiMaskedCount: data.piiMaskedCount ?? null,
      },
    });
  }

  async succeedJob(id: string, fromStatus: 'SUBMITTING' | 'SUBMITTED', now: Date = new Date()): Promise<boolean> {
    const slotKey = await this.slotKeyOf(id);
    const { count } = await this.prisma.kbIngestJob.updateMany({
      where: { id, status: fromStatus },
      data: { status: 'SUCCEEDED', resultCode: 'OK', completedAt: now, slotToken: null },
    });
    if (count !== 1) return false;
    if (slotKey) await this.releaseSlot(slotKey);

    const job = await this.prisma.kbIngestJob.findUnique({ where: { id } });
    if (job) {
      // [pass 5 · RG-6 · AC-KB3-5] 문서를 갱신하기 **전에** 이전에 적재한 값을 읽어 축소 여부를 판정한다. 이전에 적재됐고 이번 값이
      // 절반 미만이면 적재하되 정리 필요(SHRUNK)를 단다(이미 다른 정리 사유가 있으면 보존). HTML은 본문 길이, 파일은 바이트 크기다.
      const prev = await this.prisma.kbDocument.findUnique({ where: { id: job.documentId }, select: { textLength: true, byteSize: true, lastIngestedAt: true, cleanupReason: true } });
      const isHtml = job.fileKind === 'HTML';
      const shrunk = !!prev && !prev.cleanupReason && isShrunk(prev, { textLength: isHtml ? job.textLength : null, byteSize: isHtml ? null : job.byteSize });
      await this.prisma.kbDocument.updateMany({
        where: { id: job.documentId },
        data: {
          ...(shrunk ? { cleanupReason: 'SHRUNK' } : {}),
          contentHash: job.contentHash ?? undefined,
          ingestFingerprint: job.ingestFingerprint ?? undefined,
          textLength: job.textLength ?? undefined,
          byteSize: job.byteSize ?? undefined,
          externalFileName: job.externalFileName ?? undefined,
          lastIngestedAt: now,
          lastIngestJobId: id,
          activeIngestJobId: null,
          consecutiveIngestFailures: 0,
        },
      });
    }
    return true;
  }

  /** 조회 대상(SUBMITTED · 조회 간격 경과) 1건 — 인스턴스·슬롯과 무관하게 아무 인스턴스나 조회할 수
   * 있다(완료 확인은 멱등 — 중복 제출을 만들지 않는다). */
  async findDuePolling(pollMs: number, now: Date) {
    return this.prisma.kbIngestJob.findFirst({
      where: { status: 'SUBMITTED', OR: [{ lastPolledAt: null }, { lastPolledAt: { lte: new Date(now.getTime() - pollMs) } }] },
      orderBy: { lastPolledAt: 'asc' },
    });
  }

  /** 문서의 "진행 중 적재 1건" 표식을 푼다. `countAsFailure`는 FAILED·TIMEOUT처럼 진짜 실패일 때만 true —
   * 건너뜀(SKIPPED)·중지·설정 변경 취소는 실패가 아니다(EX-KB-3 "반복 실패" 배지의 근거). */
  private async releaseDocumentActiveJob(jobId: string, countAsFailure: boolean): Promise<void> {
    const job = await this.prisma.kbIngestJob.findUnique({ where: { id: jobId }, select: { documentId: true } });
    if (!job) return;
    await this.prisma.kbDocument.updateMany({
      where: { id: job.documentId, activeIngestJobId: jobId },
      data: { activeIngestJobId: null, ...(countAsFailure ? { consecutiveIngestFailures: { increment: 1 } } : {}) },
    });
  }

  /** 여러 작업이 종결(중지·스윕)될 때 문서 표식만 푼다 — 연속 실패 수는 건드리지 않는다. */
  private async clearDocumentActiveJobs(jobIds: readonly string[], tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    // SQLite는 한 문장의 바인딩 변수가 32,766개를 넘으면 실패한다 — 대량 실행의 대기 작업 전부를 한 번에 `in`에 넣지 않는다.
    for (let i = 0; i < jobIds.length; i += 500) {
      await db.kbDocument.updateMany({ where: { activeIngestJobId: { in: jobIds.slice(i, i + 500) } }, data: { activeIngestJobId: null } });
    }
  }

  /**
   * [pass 6 · RG-19] 이 작업이 속한 실행이 이미 종단 상태(중지·실패 등)라 제출하면 안 될 때 — PENDING 작업을 CANCELLED로 끝내고 문서의 "진행 중
   * 적재 1건" 표식을 푼다(실패가 아니므로 연속 실패 수는 그대로). [pass 8 · RG-22④] `resultCode`는 그 실행의 종료 사유를 따른다 — 소스 일시중지·거버넌스 위반이면 `CONFIG_CHANGED`,
   * 관리자 중지 등은 `CANCELLED_BY_USER`(`cancelRun`과 같은 규칙).
   */
  async cancelJobRunTerminated(id: string): Promise<boolean> {
    const job = await this.prisma.kbIngestJob.findUnique({ where: { id }, select: { runId: true } });
    const run = job ? await this.prisma.kbSyncRun.findUnique({ where: { id: job.runId }, select: { failureCode: true } }) : null;
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', resultCode: cancelJobResultCode(run?.failureCode) } });
    if (count === 1) await this.releaseDocumentActiveJob(id, false);
    return count === 1;
  }

  /**
   * [pass 6 · RG-19] 크롤 종결 CAS에 졌을 때(중지·다른 인스턴스가 먼저 끝냄) 방금 만든 PENDING 작업을 정리한다. 실행이 아직 진행 중(QUEUED·CRAWLING·INGESTING — 다른
   * 인스턴스가 이어받았거나 이미 적재 단계)이면 그쪽이 쓸 작업이라 건드리지 않고, 종단 상태일 때만 지운다. 정리한 작업 수를 돌려준다.
   */
  async cancelPendingJobsOfTerminatedRun(runId: string): Promise<number> {
    const run = await this.prisma.kbSyncRun.findUnique({ where: { id: runId }, select: { status: true, failureCode: true } });
    if (!run || ['QUEUED', 'CRAWLING', 'INGESTING'].includes(run.status)) return 0;
    const pending = await this.prisma.kbIngestJob.findMany({ where: { runId, status: 'PENDING' }, select: { id: true } });
    if (pending.length === 0) return 0;
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { runId, status: 'PENDING' }, data: { status: 'CANCELLED', resultCode: cancelJobResultCode(run.failureCode) } }); // [pass 8 · RG-22④] 종료 사유를 따른다.
    await this.clearDocumentActiveJobs(pending.map((j) => j.id));
    return count;
  }

  async cancelJobConfigChanged(id: string): Promise<boolean> {
    const { count } = await this.prisma.kbIngestJob.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', resultCode: 'CONFIG_CHANGED' } });
    if (count === 1) await this.releaseDocumentActiveJob(id, false);
    return count === 1;
  }

  /** 작업이 쥔 슬롯 키(`이름:토큰`) — 종결 전에 읽어 둔다(종결 UPDATE가 `slotToken`을 비운다). */
  private async slotKeyOf(jobId: string): Promise<string | null> {
    const job = await this.prisma.kbIngestJob.findUnique({ where: { id: jobId }, select: { slotToken: true } });
    return job?.slotToken ?? null;
  }

  /* ───────────────────────── 적재 슬롯 임대 · vLLM 상태 캐시 ───────────────────────── */

  async ensureLeaseRow(name: string): Promise<void> {
    try {
      await this.prisma.kbJobLease.create({ data: { name } });
    } catch {
      // P2002 — 이미 존재. 무시.
    }
  }

  /**
   * 빈(또는 임대 만료된) 슬롯 1개를 CAS로 선점한다. 선점한 슬롯이 **직전 보유자가 죽어 만료된 것**이고 그 슬롯
   * 소속 작업이 외부 RAG에서 아직 진행 중(SUBMITTED)이면, 슬롯과 작업을 함께 이어받는다(§9.4 — 같은
   * `taskId`를 계속 조회한다, 재전송 아님). 이어받은 슬롯은 그 작업이 종단 상태가 될 때까지 우리가
   * 쥐므로 새 제출에는 쓰지 않고 다음 슬롯으로 넘어간다(전역 직렬 유지).
   */
  async claimAnySlot(slotNames: readonly string[], leaseMs: number, now: Date, holderJobId: string): Promise<string | null> {
    for (const name of slotNames) {
      const row = await this.prisma.kbJobLease.findUnique({ where: { name } });
      const free = !row || !row.claimToken || !row.claimedAt || isLeaseExpired(row.claimedAt, now, leaseMs);
      if (!free) continue;
      const token = randomUUID();
      // [R1 리뷰 H-1 수정] 예전엔 `OR: [{ claimToken: null }, { claimToken: row?.claimToken ?? undefined }]`
      // 였다 — claimToken이 null(빈 슬롯)일 때 `null ?? undefined` → `undefined`가 되어 그 갈래의
      // 필드 자체가 where에서 빠진다. Prisma가 undefined 필드를 어떻게 접든(내부 동작에 기대지
      // 않기 위해) CAS 판정을 OR/undefined 조합이 아니라 **단순 동등 비교 1개**로 명시한다 —
      // "읽은 시점의 값과 같을 때만 쓴다"는 CAS 불변식이 코드만 보고도 분명해야 한다.
      // [pass 6 · M-7] 읽은 `claimedAt`도 같아야 한다 — 토큰만 비교하면 읽은 뒤 보유자가 임대를 갱신(토큰 동일 · claimedAt만 전진)해도 낚아챈다.
      const { count } = await this.prisma.kbJobLease.updateMany({
        where: { name, claimToken: row?.claimToken ?? null, claimedAt: row?.claimedAt ?? null },
        data: { claimToken: token, claimedAt: now, holderJobId },
      });
      if (count !== 1) continue;

      const slotKey = `${name}:${token}`;
      const orphan = await this.prisma.kbIngestJob.findFirst({ where: { status: 'SUBMITTED', slotToken: { startsWith: `${name}:` } }, select: { id: true, slotToken: true } });
      if (orphan?.slotToken && orphan.slotToken !== slotKey) {
        await this.prisma.kbIngestJob.updateMany({ where: { id: orphan.id, status: 'SUBMITTED', slotToken: orphan.slotToken }, data: { slotToken: slotKey } });
        continue;
      }
      return slotKey;
    }
    return null;
  }

  /** `slotKey`가 `이름:토큰` 형식이 아니면 null — 토큰이 `undefined`로 새어 CAS 조건이 빠지면(Prisma는
   * `undefined` 필드를 where에서 뺀다) 남의 슬롯까지 놓아 버리기 때문에 형식을 먼저 확인한다. */
  private parseSlotKey(slotKey: string): { name: string; token: string } | null {
    const idx = slotKey.indexOf(':');
    if (idx <= 0 || idx === slotKey.length - 1) return null;
    return { name: slotKey.slice(0, idx), token: slotKey.slice(idx + 1) };
  }

  async releaseSlot(slotKey: string, tx?: Prisma.TransactionClient): Promise<void> {
    const parsed = this.parseSlotKey(slotKey);
    if (!parsed) return;
    await (tx ?? this.prisma).kbJobLease.updateMany({ where: { name: parsed.name, claimToken: parsed.token }, data: { claimToken: null, claimedAt: null, holderJobId: null } });
  }

  /** 슬롯 임대 연장 — 토큰이 다르면(다른 인스턴스가 이미 이어받음) 아무 일도 없다(CAS). */
  async renewSlot(slotKey: string, now: Date): Promise<boolean> {
    const parsed = this.parseSlotKey(slotKey);
    if (!parsed) return false;
    const { count } = await this.prisma.kbJobLease.updateMany({ where: { name: parsed.name, claimToken: parsed.token }, data: { claimedAt: now } });
    return count === 1;
  }

  async getLeaseState(name: string): Promise<string> {
    const row = await this.prisma.kbJobLease.findUnique({ where: { name } });
    return row?.state ?? '{}';
  }

  /**
   * 실행 화면의 "대기 사유"(§9.6)를 정하는 입력 — 외부 RAG 준비 상태(적재 제출 직전 확인이 60초 캐시로 남긴
   * `INGEST_STATUS`)와 실행별 대기 중 BULK 작업 수. 실행 목록은 실행 id를 묶어 한 번에 부른다.
   */
  async getWaitingContext(runIds: readonly string[]): Promise<{ ragReady: boolean | null; ragCheckedAt: Date | null; pendingBulkByRun: Map<string, number> }> {
    let ragReady: boolean | null = null;
    let ragCheckedAt: Date | null = null;
    try {
      const state = JSON.parse(await this.getLeaseState('INGEST_STATUS')) as { vllmReady?: boolean; checkedAt?: string };
      ragReady = typeof state.vllmReady === 'boolean' ? state.vllmReady : null;
      ragCheckedAt = state.checkedAt ? new Date(state.checkedAt) : null;
    } catch {
      ragReady = null;
    }
    const pendingBulkByRun = new Map<string, number>();
    if (runIds.length > 0) {
      const groups = await this.prisma.kbIngestJob.groupBy({ by: ['runId'], where: { runId: { in: [...runIds] }, status: 'PENDING', lane: 'BULK' }, _count: { _all: true } });
      for (const g of groups) pendingBulkByRun.set(g.runId, g._count._all);
    }
    return { ragReady, ragCheckedAt, pendingBulkByRun };
  }

  async setLeaseState(name: string, state: string): Promise<void> {
    await this.prisma.kbJobLease.upsert({ where: { name }, create: { name, state }, update: { state } });
  }
}

/**
 * 중지된(종단) 실행의 대기 작업이 남기는 `resultCode` — 관리자가 직접 중지한 실행만 `CANCELLED_BY_USER`이고, 소스 일시중지(`SOURCE_DISABLED`)·거버넌스 규칙 위반으로 끝난 실행은 `CONFIG_CHANGED`다
 * (소스가 꺼져 있어/규칙에 걸려 제출을 취소하는 기존 경로 `cancelJobConfigChanged`와 같은 값 — 설계 §9.9 · RG-20③ · RG-22④).
 */
function cancelJobResultCode(runFailureCode: string | null | undefined): 'CONFIG_CHANGED' | 'CANCELLED_BY_USER' {
  return runFailureCode === 'SOURCE_DISABLED' || runFailureCode === 'GOVERNANCE_MASK_REQUIRED' || runFailureCode === 'GOVERNANCE_RAW_FILE_NOT_ALLOWED' ? 'CONFIG_CHANGED' : 'CANCELLED_BY_USER';
}

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeParseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
