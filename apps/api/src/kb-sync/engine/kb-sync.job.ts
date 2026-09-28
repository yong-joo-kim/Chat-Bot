import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KB_SYNC_LIMITS } from '@chat-bot/shared-types';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { PollingLoop } from '../../common/polling/polling-loop';
import type { TickSignal } from '../../common/polling/polling-loop';
import { KbRunStore } from '../core/kb-run.store';
import { KbScheduler } from './kb-scheduler';
import { KbCrawlRunner } from './kb-crawl.runner';
import { KbIngestRunner } from './kb-ingest.runner';
import { parseSourceRow } from '../lib/parse-source-row';
import { KB_EXTRACTOR, WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';
import { kbErrorCode, kbLogLine } from '../lib/kb-log-line';

const TICK_BUDGET_MS = 30_000;
/** [pass 6 · RG-17] 적재 조각이 크롤에 다 먹히지 않도록 tick 예산에서 항상 남겨 두는 시간. */
const INGEST_RESERVE_MS = 5_000;
/**
 * [pass 6 · RG-18 · pass 8 · N-11] 크롤 후보를 넉넉히 읽는다 — 호스트가 겹쳐 대기 중인 실행(QUEUED)이 앞자리를 막아 다른 소스 실행이 굶지 않게 읽은 뒤 거른다. 활성 실행은 소스당 동시 실행 1이라 최대
 * 소스 등록 상한(`KB_SYNC_LIMITS.maxSources`)개이므로 그 값에서 파생한다 — 예전 고정 20개는 같은 호스트 소스가 20개를 넘으면 뒤의 다른 호스트 실행을 후보에서 잘라 굶겼다.
 */
const CRAWL_CANDIDATE_MIN = KB_SYNC_LIMITS.maxSources;

/**
 * ★ `PollingLoop` 사용 유일 파일(No.43, KB-12). 예약(스케줄러) → 크롤 조각(활성 실행마다) → 적재
 * 조각 → (다음 tick으로) 순서로 tick 예산(30초) 안에서 처리한다. `tick()`은 public(시험 직접 호출).
 */
@Injectable()
export class KbSyncJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('KbSyncJob');
  private readonly loop: PollingLoop;

  constructor(
    private readonly config: ConfigService,
    private readonly store: KbRunStore,
    private readonly scheduler: KbScheduler,
    private readonly crawlRunner: KbCrawlRunner,
    private readonly ingestRunner: KbIngestRunner,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(KB_EXTRACTOR) private readonly extractor: KbExtractorPort,
  ) {
    this.loop = new PollingLoop({ name: 'kb-sync', intervalMs: this.intervalMs(), onTick: (signal) => this.tick(signal), logger: this.logger });
  }

  private enabled(): boolean {
    return this.config.get<boolean>('KB_SYNC_ENABLED') ?? false;
  }
  private intervalMs(): number {
    return this.config.get<number>('KB_SYNC_INTERVAL_MS') ?? 10_000;
  }
  private maxParallelSources(): number {
    return this.config.get<number>('KB_SYNC_MAX_PARALLEL_SOURCES') ?? 2;
  }

  /**
   * [R1 리뷰 M-2] `KB_SYNC_ENABLED=true`일 때만 워커 엔트리 존재를 부팅 시점에 미리 확인한다(작업
   * 스레드를 실제로 띄우지 않고 — `checkAvailability()`). 없으면 명확한 오류 로그를 남기고 **루프
   * 자체를 시작하지 않는다** — "보류 상태로 처리를 쌓아 두기"가 아니라 이 선택을 고른 이유:
   * (1) 이미 켜 둔 인스턴스가 매 tick 같은 오류를 반복 생성하는 것보다, 운영자가 `pnpm build`로
   * 고치기 전까지 아예 조용히 대기하는 편이 신호가 더 명확하다(로그 폭주 방지). (2) `KB_SYNC_ENABLED
   * =false`와 동일한 코드 경로(루프 미시작)라 운영자 경험이 일관적이다("꺼짐"과 "설정 오류로 못 켬"
   * 둘 다 "루프가 안 돈다"로 통일). (3) H-2에서 이미 실행·문서 단위 격리를 넣어 뒀으니, 이 사전 점검은
   * "가능한 한 빨리, 가장 눈에 띄게" 알리는 역할이면 충분하다 — 별도의 "보류 큐" 개념을 새로 만들
   * 필요가 없다. `InProcessExtractor`처럼 `checkAvailability`가 없는 구현은 항상 통과한다(옵셔널).
   */
  async onApplicationBootstrap(): Promise<void> {
    const slots = this.config.get<number>('KB_INGEST_CONCURRENCY') ?? 1;
    for (let i = 0; i < slots; i += 1) await this.store.ensureLeaseRow(`INGEST_SLOT_${i}`);
    await this.store.ensureLeaseRow('INGEST_STATUS');

    if (!this.enabled()) {
      this.logger.log('KB_SYNC_ENABLED=false — 지식베이스 동기화 루프를 가동하지 않습니다.');
      return;
    }

    try {
      this.extractor.checkAvailability?.();
    } catch (e) {
      if (e instanceof WorkerEntryMissingError) {
        // 고정 문구만 — 오류 원문에는 서버 경로가 들어 있다(KB-15).
        this.logger.error('지식베이스 동기화 루프를 시작하지 않습니다 — 문서 해석 워커 진입점(extract.worker.js)을 찾을 수 없습니다. `pnpm build`를 먼저 실행하세요.');
        return;
      }
      throw e;
    }

    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop(30_000);
  }

  /**
   * 시험은 이 메서드를 직접 호출한다(루프는 시험 환경에서 꺼져 있다 — CLAUDE.md).
   * [R1 리뷰 M-4] `KB_SYNC_ENABLED` 이중 방어 — `PollingLoop`가 꺼져 있으면 원래 `tick()` 자체가
   * 호출되지 않지만, 시험이나 다른 경로로 직접 호출될 가능성에 대비해 첫머리에서도 다시 확인한다.
   */
  async tick(signal?: TickSignal): Promise<void> {
    if (!this.enabled()) return;

    const now = this.clock.now();
    const deadline = Date.now() + TICK_BUDGET_MS;
    const stopping = (): boolean => signal?.stopping() ?? false;

    await this.scheduler.scheduleDueSources(now, 10);

    // [pass 6 · RG-17·RG-18] 크롤 예산(tick 예산 − 적재 몫)을 **처리하는 실행 수로 나눠** 실행별 조각 기한을 준다 — 앞 실행이 조각 안에서 호스트 간격을 기다리며 예산을 다 써
    // 뒤 실행이 굶지 않게 하고, 일찍 끝난 실행의 남은 시간은 뒤 실행이 이어 쓴다. 후보는 넉넉히 읽어 호스트 겹침으로 시작하지 못한(`false`) 실행은 세지 않고 건너뛴다.
    const maxParallel = this.maxParallelSources();
    const crawlEnd = deadline - INGEST_RESERVE_MS;
    const activeRuns = await this.store.findActiveRunsForCrawl(Math.max(CRAWL_CANDIDATE_MIN, maxParallel * 10));
    let processed = 0;
    for (const [index, run] of activeRuns.entries()) {
      if (processed >= maxParallel || Date.now() >= crawlEnd || stopping()) break;
      try {
        const sourceRow = await this.store.findSourceById(run.sourceId);
        if (!sourceRow) continue;
        const source = parseSourceRow(sourceRow);
        const startedAt = Date.now();
        // [pass 7 · N-5] 나눔수 = min(남은 병렬 자리, 남은 후보 수) — 후보가 1개뿐이면 병렬 상한이 2여도 예산 전체를 쓴다(예전에는 상한으로만 나눠 단독 실행이 절반만 썼다).
        const divisor = Math.max(1, Math.min(maxParallel - processed, activeRuns.length - index));
        const runDeadline = startedAt + Math.max(0, crawlEnd - startedAt) / divisor;
        // [R1 리뷰 H-2] `crawlRunner.runFragment()`가 이미 실행 단위로 예외를 가두지만, 이 for 루프
        // 자체도 이중으로 격리한다(§H-2 "processLoop 수준에서도 실행 단위로 격리") — 한 실행을 준비
        // (소스 조회·파싱)하다 난 예외까지 포함해 다른 실행의 처리를 막지 않는다.
        const worked = await this.crawlRunner.runFragment({ id: run.id, sourceId: run.sourceId, kind: run.kind as 'PREVIEW' | 'SYNC' | 'FULL_RESEND' }, source, runDeadline, stopping);
        if (worked) processed += 1;
      } catch (e) {
        // 다음 실행으로 넘어간다. 오류 원문은 남기지 않는다(KB-15).
        this.logger.error(kbLogLine({ host: '-', path: `run/${run.id}`, code: kbErrorCode(e) }));
      }
    }

    // 적재 조각 — tick 예산이 남아 있는 동안, 실제로 처리할 일이 있는 한 계속한다(시각 추정이 아니라
    // `runFragment()`의 반환값으로 판정 — 유휴 tick이 30초를 다 쓰는 회귀를 막는다).
    while (Date.now() < deadline && !stopping()) {
      const didWork = await this.ingestRunner.runFragment(this.clock.now());
      if (!didWork) break;
    }
  }
}
