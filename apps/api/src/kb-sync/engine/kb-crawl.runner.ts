import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KbCleanupReason, KbExcludeReason } from '@chat-bot/shared-types';
import { KbRunStore } from '../core/kb-run.store';
import { KbSourcesService } from '../kb-sources.service';
import { KbCrawlHttpFetcher } from '../crawl/kb-crawl-http.fetcher';
import { KbHostPacer } from '../crawl/kb-host-pacer';
import { KbSecretResolver } from '../crawl/kb-secret.resolver';
import { fetchFollowingRedirects } from '../crawl/kb-redirect-follow';
import type { FollowOptions, FollowResult, FollowResume } from '../crawl/kb-redirect-follow';
import { KB_EXTRACTOR, WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';
import { normalizeUrl, urlHostname, urlHostPort } from '../lib/url-normalize';
import { canSendAuthTo } from '../lib/allowed-origins';
import { isInScope } from '../lib/scope-match';
import { resolveLinks } from '../lib/link-extract';
import { parseRobots, robotsFetchOutcome } from '../lib/robots';
import type { RobotsRules } from '../lib/robots';
import { decodeBody } from '../lib/charset';
import { sha256Hex, computeIngestFingerprint } from '../lib/content-fingerprint';
import { decideChange } from '../lib/change-detect';
import { parseXRobotsTag } from '../lib/x-robots-tag';
import { HOST_THROTTLE_ABORT_STREAK, throttleDelayMs } from '../lib/throttle-delay';
import { inspectRawFile } from '../lib/inspect-raw-file';
import { nextMissingState } from '../lib/missing-detect';
import type { MissingObservation } from '../lib/missing-detect';
import { evaluateRunGuards } from '../lib/run-guards';
import { buildExternalFileName, urlHash as computeUrlHash } from '../lib/external-file-name';
import type { ExternalFileExt } from '../lib/external-file-name';
import { kbErrorCode, kbLogLine } from '../lib/kb-log-line';
import { decideIngestLane } from '../lib/ingest-lane';
import { httpOrHttpsScheme } from '../lib/url-scheme';
import { HTML_MAX_BYTES, MAX_HOST_INTERVAL_MS } from '../lib/crawl-limits';
import { detectKind, isFileUrl } from '../lib/detect-kind';
import { setBounded } from '../lib/bounded-map';
import { bodyObservedHash, hasLoginSignal, outOfScopeTargetHash, redirectLoginTargetHash, redirectOriginHash } from '../lib/observed-hash';

interface RunRow {
  id: string;
  sourceId: string;
  kind: 'PREVIEW' | 'SYNC' | 'FULL_RESEND';
}

interface SourceConfig {
  id: string;
  name: string;
  seedUrls: string[];
  sitemapUrls: string[];
  allowedHosts: string[];
  /** [pass 12 · RG-26] 허용 출처(host:port) — 시작 주소·사이트맵에서 실행 시점에 계산한 값(`parseSourceRow`). */
  allowedOrigins: string[];
  /** [pass 13 · RG-28] `http:`를 명시한 시작 주소·사이트맵의 host:port — 평문 요청에 인증 헤더를 실어도 되는 출처(`parseSourceRow`). */
  plainHttpOrigins: string[];
  pathPrefixes: string[];
  excludePatterns: string[];
  noisePatterns: string[];
  allowQueryUrls: boolean;
  maxDepth: number;
  maxPages: number;
  fileTypes: string[];
  maxFileBytes: number;
  minIntervalMs: number;
  authKind: string;
  authHeaderName: string | null;
  authSecretRef: string | null;
  piiMask: boolean;
  allowRawFileIngest: boolean;
}

interface DocRow {
  id: string;
  url: string;
  kind: string;
  depth: number;
  missingStreak: number;
  state: string;
  excludeReason: string | null;
  cleanupReason: string | null;
  lastIngestedAt: Date | null;
  contentHash: string | null;
  ingestFingerprint: string | null;
  textLength: number | null;
  byteSize: number | null;
  etag: string | null;
  lastModified: string | null;
  discoveredFromId?: string | null;
}

type VisitOutcome =
  | { kind: 'ADDED_TO_INGEST'; reason: 'NEW' | 'CHANGED' }
  | { kind: 'HTML_VISITED' }
  | { kind: 'THROTTLED'; retryAfter?: string }
  /** 요청 직전 훅이 이 문서를 미뤘다(호스트 간격을 기다리면 조각 예산을 넘는다) — 문서는 QUEUED로 두고 조각을 끝낸다. */
  | { kind: 'DEFERRED' }
  | { kind: 'UNCHANGED' | 'GONE' | 'EXCLUDED' | 'ERROR' };

/** 조각 결과 — `CONTINUE` = 다음 tick에 이어감 · `DONE` = 이 인스턴스가 종결까지 마침 · `LOST` = 임대를 잃음(중지·인수·종결). */
type LoopResult = 'CONTINUE' | 'DONE' | 'LOST';

/** 시작 주소 판정 — `REACHED` 응답을 받음 · `FAILED` 요청했거나 중단 호스트로 건너뛰었는데 실패 · `NEUTRAL` 요청 없이 제외(원본 파일 전달 꺼짐). */
type SeedVerdict = 'REACHED' | 'FAILED' | 'NEUTRAL';

/** 크롤 조각 안에서 문서 하나를 처리하는 동안 쓰는 실행 문맥. */
interface CrawlCtx {
  run: RunRow;
  source: SourceConfig;
  /** 조각 기한(`pacer.now()` 시계) — 호스트 간격을 기다리다 이 기한을 넘게 되면 그 자리에서 조각을 끝낸다. */
  deadline: number;
  stopping: () => boolean;
  abortedHosts: Set<string>;
  abortHost: (host: string, cause: 'ROBOTS' | 'THROTTLE') => Promise<void>;
  /**
   * [pass 7 · N-10] 크롤 임대를 갱신한다 — 마지막 갱신 뒤 `minGapMs`가 지나지 않았으면 아무것도 하지 않고 `true`, 갱신에 실패하면(중지·다른 인스턴스의 인수) `false`. 홉 사이·호스트 간격 대기 중에도
   * 불러 임대가 타임아웃 × 홉 수만큼 긴 처리 구간에 만료되지 않게 하고, 중지된 실행이 대기가 끝난 뒤 새 요청을 보내지 않게 한다.
   */
  renewLease: (minGapMs: number) => Promise<boolean>;
  /** 이 문서를 처리하다 예외가 나도 시작 주소 판정이 오염되지 않게, 판정이 정해진 시점에 기록해 둔다. */
  verdict: SeedVerdict | null;
}

/** 사이트맵 한도(§6.6 · §7.3) — 파일 ≤ 50개(색인이 가리키는 자식 포함) · 파일당 압축 10MB. 해제 50MB 상한은 작업 스레드(`gzip-guard.ts`)가 집행한다. */
const SITEMAP_MAX_FILES = 50;
const SITEMAP_MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;

/** 사이트맵 읽기 예산 — 남은 파일 수 · 요청 직전 임대 갱신(실패 = `false`) · 갱신 실패로 물러났는가(`lost`). */
interface SitemapBudget {
  remaining: number;
  renew: () => Promise<boolean>;
  lost: boolean;
}

/** 인스턴스 메모리 맵 상한(RG-20⑦) — 다른 인스턴스가 끝낸 실행의 항목이 영구히 남아 자라지 않게 가장 오래된 항목부터 버린다(잃어도 1회 더 재시도할 뿐이다). */
const MAX_TRACKED_RUNS = 200;
const MAX_THROTTLE_STREAK_KEYS = 1000;
const MAX_ROBOTS_CACHE = 500;

/** 한 번 잘 때 최대 대기(ms) — 길게 자는 동안에도 중지 요청·조각 기한을 자주 확인한다. */
const SLEEP_SLICE_MS = 1000;
/**
 * [pass 7 · N-10] 호스트 간격을 기다리는 동안 임대를 갱신하는 최소 간격(ms). [pass 9 · L-3] 요청 직전 갱신은 간격 없이 **항상** 한다(예전에는 마지막 갱신 뒤 2초 안이면 건너뛰어, 중지 직후 최대 2초 동안 요청이 나갈 수 있었다).
 */
const LEASE_RENEW_WAIT_GAP_MS = 10_000;
/**
 * [pass 9 · M-4] 리다이렉트 진행 상태(`redirectResume`) 상한·유효 시간. 소스 간격 최대 300초 × 홉 3회 = 15분이 정상 최대 대기이므로 30분이 지난 상태는 오래된 것으로 보고 버린다(홉 0부터 다시 — 요청 1회 중복일 뿐이다).
 * 실행마다 머리 문서 1건만 처리하므로 실제로는 실행당 상태 1개 이하다.
 */
const MAX_TRACKED_RESUMES = 200;
const REDIRECT_RESUME_TTL_MS = 30 * 60 * 1000;

/** [pass 9 · M-4] 조각 예산 때문에 미룬 리다이렉트 문서의 진행 상태 — `startUrl`이 지금의 문서 URL과 같고 `savedAt`이 유효할 때만 다음 조각이 이어간다. */
interface RedirectResumeState extends FollowResume {
  startUrl: string;
  savedAt: number;
}

/**
 * [신규 No.43] 크롤 조각 실행(§9.3) — tick 예산 안에서 URL 1개씩 처리한다. 인스턴스가 죽어도 DB
 * 프런티어(`KbDocument`)가 남아 다른 인스턴스가 이어서 간다(R-5).
 */
@Injectable()
export class KbCrawlRunner {
  private readonly logger = new Logger('KbCrawlRunner');
  private readonly robotsCache = new Map<string, { rules: RobotsRules | 'ALLOW_ALL'; fetchedAt: number }>();
  /**
   * [pass 5 · RG-9] 이 인스턴스가 **자기가 획득한** 크롤 임대 토큰(실행 id → 토큰). 남의 토큰을 DB에서 읽어 갱신하지 않는다 — 토큰이
   * 없으면(다른 인스턴스가 쥐었거나 재시작 뒤) 처리하지 않고, 임대가 만료됐을 때 `claimCrawlLease()`의 인수 경로로만 이어받는다.
   */
  private readonly leaseTokens = new Map<string, string>();
  /** [pass 5 · RG-4] 429·503으로 이미 한 번 재시도한 문서(실행 id → 문서 id) — 인스턴스 메모리(잃으면 1회 더 재시도할 뿐이다). */
  private readonly retriedDocs = new Map<string, Set<string>>();
  /** [pass 5 · RG-4] 호스트별 연속 429·503 횟수(`실행 id|호스트`) — tick(조각)을 넘어 이어지도록 인스턴스 메모리에 둔다. */
  private readonly throttleStreaks = new Map<string, number>();
  /** [pass 5 · RG-1] 429·503 연속 실패로 중단한 호스트(실행 id → 호스트) — robots 불가와 구분해 실패 코드를 정하는 데 쓴다(근사 · 인스턴스 메모리). */
  private readonly throttleAborted = new Map<string, Set<string>>();
  /**
   * [pass 9 · M-4] 리다이렉트 홉 사이에서 조각 예산 때문에 미룬 문서의 진행 상태(`실행 id|문서 id` → 다음 홉 URL · 홉 번호 · 방문한 URL) — 인스턴스 메모리(스키마 변경 없음). 다음 조각은 홉 0을 다시 요청하지 않고 이 홉에서
   * 이어가므로 호스트 간격(최대 300초)이 조각 예산(약 12~25초)보다 커도 진행한다(N-1 라이브락 방지). 잃으면(재시작·다른 인스턴스·임대 재인수·만료) 홉 0부터 다시 한다 — 요청 1회 중복일 뿐 정확성 문제는 없다.
   */
  private readonly redirectResume = new Map<string, RedirectResumeState>();

  constructor(
    private readonly store: KbRunStore,
    private readonly sourcesService: KbSourcesService,
    private readonly fetcher: KbCrawlHttpFetcher,
    private readonly pacer: KbHostPacer,
    private readonly secretResolver: KbSecretResolver,
    private readonly config: ConfigService,
    @Inject(KB_EXTRACTOR) private readonly extractor: KbExtractorPort,
  ) {}

  private userAgent(): string {
    return this.config.get<string>('KB_CRAWL_USER_AGENT') ?? 'ChatBotKBCrawler/1.0';
  }
  /** `ChatBotKBCrawler/1.0` → `chatbotkbcrawler` — robots.txt·`X-Robots-Tag`의 `User-agent` 토큰은 제품 이름만이다(버전 없음). */
  private productToken(): string {
    return this.userAgent().split('/')[0].trim().toLowerCase();
  }
  private governanceOn(): boolean {
    return this.config.get<string>('DATA_GOVERNANCE_MODE') === 'ON';
  }
  private timeoutMs(): number {
    return this.config.get<number>('KB_CRAWL_TIMEOUT_MS') ?? 15000;
  }

  /**
   * 조각 1회 — 예산이 남아 있는 동안 URL을 처리한다. 프런티어가 소진되면 크롤을 종결한다.
   *
   * [R1 리뷰 H-2] `processLoop()`가 던지는 어떤 예외(워커 진입점 없음 같은 전역 설정 오류 포함)도
   * 여기서 끝까지 가둔다 — 그래야 이 실행 하나의 문제가 같은 tick의 **다른 실행**(호출부
   * `kb-sync.job.ts`의 `for` 루프)까지 멈추지 않는다(실행 단위 격리). 이 실행 자체는 이번 tick에는
   * 더 진행하지 않고(임대는 유지 — 다음 tick이 이어받는다), 예외는 로그로만 남긴다.
   *
   * [pass 6 · RG-18] 돌려주는 값 = 이 인스턴스가 이 실행의 크롤 임대를 쥐고 처리했는가. `false`(다른 인스턴스가 쥠 · 호스트가 겹치는 앞선 실행이 있어 대기 ·
   * 이미 QUEUED·CRAWLING이 아님)이면 호출부(`kb-sync.job.ts`)가 "처리한 실행 수"에 세지 않고 다음 후보로 넘어간다.
   */
  async runFragment(run: RunRow, source: SourceConfig, budgetDeadline: number, stopping: () => boolean): Promise<boolean> {
    let acquired = false;
    try {
      const token = await this.acquireLease(run.id);
      if (!token) return false; // 다른 인스턴스가 쥐고 있거나(임대 유효) 겹치는 실행이 앞서 있거나 QUEUED·CRAWLING이 아니다 — 처리하지 않는다.
      acquired = true;
      const result = await this.processLoop(run, source, token, budgetDeadline, stopping);
      if (result !== 'CONTINUE') this.forgetRun(run.id);
    } catch (e) {
      // 이번 tick은 여기서 멈추고 다음 tick에 이어간다(임대는 유지). 오류 원문은 남기지 않는다(KB-15) — 실행 id와 클래스명 코드만.
      this.logger.error(kbLogLine({ host: '-', path: `run/${run.id}`, code: kbErrorCode(e) }));
    }
    return acquired;
  }

  /**
   * [pass 5 · RG-9] 이 인스턴스의 크롤 임대 토큰을 돌려준다. ① 이미 쥔 토큰이 있으면 **그 토큰으로** 갱신한다(실패 = 중지·인수·종결로
   * 잃음 → 버리고 인수 경로로). ② 없으면 `claimCrawlLease()`로 새로 얻는다(QUEUED 선점 · 만료된 CRAWLING 인수 — 유효한 임대를 다른
   * 인스턴스가 쥐고 있으면 `null`). DB에서 읽은 남의 토큰으로 갱신한 뒤 처리하던 예전 경로는 없다.
   */
  private async acquireLease(runId: string): Promise<string | null> {
    const held = this.leaseTokens.get(runId);
    if (held) {
      if (await this.store.renewCrawlLease(runId, held, new Date())) return held;
      this.leaseTokens.delete(runId);
      this.dropResumeStates(runId); // 임대를 잃었다 — 그동안 다른 인스턴스가 이어받았을 수 있어 이전 소유 때의 진행 상태는 믿지 않는다.
    }
    const token = await this.store.claimCrawlLease(runId, this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600000, new Date());
    if (!token) return null;
    this.dropResumeStates(runId); // 새로 얻은 임대(선점·인수) — 앞선 소유의 상태가 남아 있어도 버린다.
    setBounded(this.leaseTokens, runId, token, MAX_TRACKED_RUNS);
    return token;
  }

  /** 실행이 끝났거나(종결) 임대를 잃었을 때 이 실행에 매인 인스턴스 메모리 상태를 버린다. */
  private forgetRun(runId: string): void {
    this.leaseTokens.delete(runId);
    this.retriedDocs.delete(runId);
    this.throttleAborted.delete(runId);
    this.dropResumeStates(runId);
    for (const key of this.throttleStreaks.keys()) if (key.startsWith(`${runId}|`)) this.throttleStreaks.delete(key);
  }

  /** 이 실행에 매인 리다이렉트 진행 상태를 버린다(M-4). */
  private dropResumeStates(runId: string): void {
    for (const key of this.redirectResume.keys()) if (key.startsWith(`${runId}|`)) this.redirectResume.delete(key);
  }

  /**
   * 프런티어 씨앗 넣기. [pass 8] 사이트맵 파일 요청(최대 50개 × 타임아웃)마다 그 직전에 크롤 임대를 갱신한다(`renewLease`) — 갱신하지 않으면 사이트맵이 느린 소스에서 씨앗 넣기만으로 임대가 만료돼
   * 다른 인스턴스가 인수해 같은 요청을 되풀이한다. 갱신에 실패하면(중지·다른 인스턴스의 인수) 즉시 `'LOST'` — 프런티어를 만들지 않고 물러난다(다음 소유자가 처음부터 한다). `renewLease`가 없으면(단위 시험)
   * 갱신하지 않는다.
   */
  private async ensureSeeded(run: RunRow, source: SourceConfig, renewLease?: (minGapMs: number) => Promise<boolean>): Promise<'OK' | 'LOST'> {
    const counts = await this.store.countFrontier(source.id, run.id);
    if (counts.total > 0) return 'OK'; // 이미 씨앗을 넣었다(재개).

    const entries: Array<{ url: string; urlHash: string; kind: string; externalFileName: string; depth: number }> = [];
    const seen = new Set<string>();
    const pushUrl = (raw: string, depth: number): void => {
      const normalized = normalizeUrl(raw, { allowQueryUrls: source.allowQueryUrls });
      if (!normalized) return;
      if (!isInScope(normalized, depth, source)) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      const kind = detectKind(normalized, undefined, source.fileTypes);
      if (!kind) return;
      const uh = computeUrlHash(normalized);
      entries.push({ url: normalized, urlHash: uh, kind, externalFileName: buildExternalFileName(source.id, normalized, extFromKind(kind)), depth });
    };

    for (const seed of source.seedUrls) pushUrl(seed, 0);

    // 사이트맵 파일은 색인의 자식까지 합쳐 실행당 50개까지만 읽는다(§6.6).
    const sitemapBudget: SitemapBudget = { remaining: SITEMAP_MAX_FILES, renew: renewLease ? () => renewLease(0) : async () => true, lost: false };
    for (const sitemapUrl of source.sitemapUrls) {
      if (sitemapBudget.remaining <= 0) break;
      for (const loc of await this.loadSitemapLocs(sitemapUrl, source, sitemapBudget)) {
        if (entries.length >= source.maxPages) break;
        pushUrl(loc, 0);
      }
      if (sitemapBudget.lost) return 'LOST';
    }

    await this.store.seedFrontier(source.id, run.id, entries.slice(0, source.maxPages));
    return 'OK';
  }

  /**
   * 사이트맵 1개(과 색인이 가리키는 자식 1단계)에서 `<loc>`을 모은다(§6.6). `<sitemapindex>`는 1단계만 따라가고
   * 자식 안의 색인은 무시한다 — 예전에는 색인의 `<loc>`(자식 사이트맵 파일 주소)을 그대로 페이지 URL로 넣었다.
   * 실패·거부(DOCTYPE·ENTITY·압축 폭탄)는 그 사이트맵만 무시한다. 단 워커 진입점이 없는 전역 설정 오류는
   * 문서 탓으로 바꾸지 않고 올린다.
   */
  private async loadSitemapLocs(startUrl: string, source: SourceConfig, budget: SitemapBudget): Promise<string[]> {
    const locs: string[] = [];
    const queue: Array<{ url: string; level: 0 | 1 }> = [{ url: startUrl, level: 0 }];
    while (queue.length > 0 && budget.remaining > 0 && locs.length < source.maxPages) {
      // [pass 8] 요청 직전에 임대를 갱신한다 — 실패하면 이 요청을 보내지 않고 물러난다(호출부가 `lost`를 보고 씨앗 넣기 없이 끝낸다).
      if (!(await budget.renew())) {
        budget.lost = true;
        break;
      }
      const next = queue.shift()!;
      budget.remaining -= 1;
      const parsed = await this.fetchAndParseSitemap(next.url, source);
      if (!parsed) continue;
      if (parsed.kind === 'URLSET') locs.push(...parsed.locs);
      else if (parsed.kind === 'SITEMAPINDEX' && next.level === 0) {
        for (const child of parsed.locs.slice(0, budget.remaining)) queue.push({ url: child, level: 1 });
      }
    }
    return locs;
  }

  private async fetchAndParseSitemap(url: string, source: SourceConfig): Promise<{ kind: 'URLSET' | 'SITEMAPINDEX' | 'EMPTY'; locs: string[] } | null> {
    try {
      // 사이트맵 파일 자체의 리다이렉트는 허용 호스트 안이면 따라간다(경로 접두는 사이트맵 파일 위치에 적용하지 않는다 — 안의 URL은 씨앗 넣기에서 범위 검사).
      const res = await fetchFollowingRedirects(
        this.fetcher,
        { url, allowedHosts: source.allowedHosts, allowedOrigins: source.allowedOrigins, maxBytes: SITEMAP_MAX_COMPRESSED_BYTES, timeoutMs: this.timeoutMs(), headersFor: () => ({}) },
        { allowQueryUrls: true, scope: { allowedHosts: source.allowedHosts, allowedOrigins: source.allowedOrigins, pathPrefixes: [], excludePatterns: [], maxDepth: 0 } },
      );
      if (res.kind !== 'RESPONSE' || res.status < 200 || res.status >= 300) return null;
      // 복사본을 넘긴다 — 작업 스레드로 ArrayBuffer를 이전(transfer)하는데, `Buffer`는 공유 풀을 가리킬 수 있어
      // 그대로 이전하면 풀 전체가 분리된다.
      const result = await this.extractor.extract({ kind: 'SITEMAP', bytes: new Uint8Array(res.body), contentType: res.contentType ?? null, gzipped: url.toLowerCase().endsWith('.gz') });
      if (!result.ok || !result.sitemap || result.sitemap.kind === 'REJECTED') return null;
      return { kind: result.sitemap.kind, locs: result.sitemap.locs };
    } catch (e) {
      if (e instanceof WorkerEntryMissingError) throw e;
      return null; // 사이트맵 실패는 무시하고 시작 주소만으로 진행한다.
    }
  }

  private async processLoop(run: RunRow, source: SourceConfig, token: string, budgetDeadline: number, stopping: () => boolean): Promise<LoopResult> {
    // 고정 헤더 인증인데 비밀 값이 없으면(환경변수 미설정·무효) 헤더 없이 요청해 인증 벽만 긁어 오지 않고 실행을
    // `FAILED(SECRET_MISSING)`로 끝낸다(§6.9 — 기동 실패가 아니다). 값은 로그·응답 어디에도 없다.
    if (source.authKind === 'STATIC_HEADER' && source.authSecretRef && !this.secretResolver.get(source.authSecretRef)) {
      await this.failRun(run, source, 'SECRET_MISSING');
      return 'DONE';
    }

    let maxPagesReached = false;
    let frontierExhausted = false;
    // [pass 11 · M-A] 분모는 tick마다 다시 세지 않고 실행 시작 시점 값을 쓴다(앞선 tick에서 이 실행이 EXCLUDED·GONE으로 바꾼 문서가 분모에서 빠지지 않게).
    const priorActiveIngested = await this.store.fixPriorActiveIngested(source.id, run.id);

    // [pass 5 · RG-4·RG-1] 중단 호스트와 "시작 주소 응답 확인" 표식은 실행 행에 남겨 조각·인스턴스가 바뀌어도 이어받는다.
    const startRow = await this.store.findRun(run.id);
    const abortedHosts = new Set<string>(readStringArray(startRow?.abortedHosts));
    const seedState = readSeedState(startRow?.counts);
    const retried = this.retriedDocs.get(run.id) ?? new Set<string>();
    setBounded(this.retriedDocs, run.id, retried, MAX_TRACKED_RUNS);

    const abortHost = async (host: string, cause: 'ROBOTS' | 'THROTTLE'): Promise<void> => {
      if (abortedHosts.has(host)) return;
      abortedHosts.add(host);
      if (cause === 'THROTTLE') {
        const set = this.throttleAborted.get(run.id) ?? new Set<string>();
        set.add(host);
        setBounded(this.throttleAborted, run.id, set, MAX_TRACKED_RUNS);
      }
      await this.store.addAbortedHost(run.id, host);
    };
    // 시작 주소(깊이 0)의 판정을 실행 행에 남긴다 — 종결 때 "요청을 보낸 시작 주소가 있고 전부 실패"일 때만 삭제 감지 스윕을 건너뛰고 FAILED로 끝낸다.
    const noteSeedResult = async (doc: { depth: number }, verdict: SeedVerdict): Promise<void> => {
      if (doc.depth !== 0) return;
      if (verdict === 'REACHED' && !seedState.reached) {
        seedState.reached = true;
        await this.store.markSeedReached(run.id);
      } else if (verdict === 'FAILED' && !seedState.failed) {
        seedState.failed = true;
        await this.store.markSeedFlag(run.id, 'seedFailed');
      } else if (verdict === 'NEUTRAL' && !seedState.neutral) {
        seedState.neutral = true;
        await this.store.markSeedFlag(run.id, 'seedNeutral');
      }
    };

    let lastRenewAt = Number.NEGATIVE_INFINITY;
    const renewLease = async (minGapMs: number): Promise<boolean> => {
      const now = this.pacer.now();
      if (now - lastRenewAt < minGapMs) return true;
      const ok = await this.store.renewCrawlLease(run.id, token, new Date());
      if (ok) lastRenewAt = now;
      return ok;
    };

    // [pass 8] 씨앗 넣기(사이트맵 요청 포함)는 임대 갱신 클로저가 만들어진 뒤에 한다 — 사이트맵 요청 사이에 임대를 갱신하고, 잃으면 물러난다.
    if ((await this.ensureSeeded(run, source, renewLease)) === 'LOST') return 'LOST';

    const ctx: CrawlCtx = { run, source, deadline: budgetDeadline, stopping, abortedHosts, abortHost, renewLease, verdict: null };

    while (this.pacer.now() < budgetDeadline && !stopping()) {
      // [pass 5 · RG-9·RG-15] URL마다 **자기 토큰으로** 임대를 갱신한다. 실패하면 — 중지(`cancelRun()`이 토큰을 비운다)·다른 인스턴스의
      // 인수·이미 종결 — 새 요청 없이 즉시 조각을 끝낸다(진행 중이던 요청 1개만 마무리된다 · AC-KB5-4). 남의 토큰은 건드리지 않는다.
      if (!(await renewLease(0))) return 'LOST';

      // [pass 7 · N-3] `maxPages`는 프런티어 **행 수** 상한이다 — 행을 넣을 때(`seedFrontier(…, maxPages)`) 상한을 지키므로 여기서는 이미 넣은 행을 모두 방문한다. 예전에는 행 수(방문 + 대기)가
      // 상한에 닿는 순간 방문을 멈춰(`total >= maxPages`), 링크를 발견한 쪽수만큼 방문이 줄었다(maxPages 5 · 루트 링크 4개 → 방문 1).
      const doc = (await this.store.nextQueuedDocument(source.id, run.id)) as DocRow | null;
      if (!doc) {
        frontierExhausted = true;
        // 행 수가 상한에 닿았으면(더 발견됐더라도 넣지 못했을 수 있다) 상한 도달 — 삭제 감지를 끄고 미리보기에 경고한다(AC-KB2-5).
        maxPagesReached = (await this.store.countFrontier(source.id, run.id)).total >= source.maxPages;
        break;
      }

      ctx.verdict = null;
      const host = urlHostname(doc.url);
      if (abortedHosts.has(host)) {
        // [pass 6 · Low-1] 중단 호스트의 문서는 방문 표시만 한다 — 예전에는 상태를 ACTIVE로 덮고 제외 사유를 지웠다.
        await this.store.markVisited(doc.id, { state: doc.state as 'ACTIVE' | 'GONE' | 'EXCLUDED', excludeReason: doc.excludeReason, missingStreak: doc.missingStreak, observedChange: null });
        await noteSeedResult(doc, 'FAILED');
        await this.carryChildren(doc, ctx); // 링크를 확인하지 못했으니 지난번에 알던 자식(다른 호스트일 수 있다)을 이어 넣는다.
        continue;
      }
      // [pass 5 · RG-7] 원본 파일 전달이 꺼진 소스의 문서 파일은 내려받지 않고(요청 0 · 페이서 대기 0) 제외로만 남긴다 —
      // 미리보기에 "제외(원본 파일 전달 꺼짐)"로 보이고, 적재 단계에서야 SKIPPED로 알게 되는 일이 없다.
      // [pass 6 · M-8] 요청 없이 제외한 시작 주소는 사이트가 응답했다는 증거가 아니다 — 도달로 세지 않는다(중립).
      if (doc.kind !== 'HTML' && !source.allowRawFileIngest) {
        await this.finalizeExcluded(doc, 'RAW_FILE_OFF' as KbExcludeReason);
        await noteSeedResult(doc, 'NEUTRAL');
        continue;
      }

      // [R1 리뷰 L-2] robots.txt는 이 문서 URL의 실제 스킴을 따른다(http만 쓰는 사내 사이트 지원 —
      // 이전엔 https를 하드코딩해 그런 사이트의 robots.txt를 영영 못 가져왔다).
      const robots = await this.getRobots(doc.url, source, ctx);
      if (robots === 'DEFERRED') break; // 호스트 간격을 기다리면 이번 조각 예산을 넘는다 — 다음 조각에서 이어간다.
      if (robots === 'ABORT_HOST') {
        await abortHost(host, 'ROBOTS');
        continue;
      }
      if (robots !== 'ALLOW_ALL' && !robots.isAllowed(pathAndQuery(doc.url))) {
        await this.finalizeMissing(doc, 'ROBOTS_BLOCKED');
        await noteSeedResult(doc, 'REACHED');
        await this.carryChildren(doc, ctx);
        continue;
      }

      // [R1 리뷰 H-2] `visitOne()`이 드물게 예외를 올려보내도(예: 전역 설정 오류) 호스트 페이서는 요청 훅이 풀어준다 — 그러지 않으면 이 인스턴스가
      // 살아있는 동안 이 호스트가 영원히 잠긴다. 예외 시점에 이미 사이트가 응답했으면(링크 발견 중 DB 오류 등) 시작 주소 판정은 그대로 남긴다(pass 6 · H-1).
      let outcome: VisitOutcome;
      try {
        outcome = await this.visitOne(doc, ctx);
      } catch (e) {
        if (ctx.verdict) await noteSeedResult(doc, ctx.verdict);
        throw e;
      }
      if (outcome.kind === 'DEFERRED') break;

      let verdict: SeedVerdict = outcome.kind === 'ERROR' ? 'FAILED' : 'REACHED';
      if (outcome.kind === 'THROTTLED') {
        // [pass 5 · RG-4] 429·503이면 다음 요청까지 `Retry-After`(없으면 간격×4 · 최대 60초)를 기다린다 — 그 지연은 요청 훅(`afterRequest`)이 페이서에 반영했다.
        const streakKey = `${run.id}|${host}`;
        const streak = (this.throttleStreaks.get(streakKey) ?? 0) + 1;
        setBounded(this.throttleStreaks, streakKey, streak, MAX_THROTTLE_STREAK_KEYS);
        if (streak >= HOST_THROTTLE_ABORT_STREAK) {
          // 호스트 연속 5회 — 그 호스트를 이번 실행에서 중단한다(사이트 부하 예의 · FR-KB2-5). 이 문서도 일시 오류로 끝낸다.
          await abortHost(host, 'THROTTLE');
          await this.finalizeMissing(doc, 'TRANSIENT');
          await this.carryChildren(doc, ctx);
          verdict = 'FAILED';
        } else if (!retried.has(doc.id)) {
          retried.add(doc.id); // 문서는 QUEUED로 남겨 지연이 지난 뒤(같은 조각 또는 다음 tick) 한 번 더 시도한다.
          this.logger.log(kbLogLine({ host, path: urlPath(doc.url), code: outcome.kind }));
          continue;
        } else {
          await this.finalizeMissing(doc, 'TRANSIENT'); // 재시도도 실패 — 삭제로 세지 않는다.
          await this.carryChildren(doc, ctx);
          verdict = 'FAILED';
        }
      } else if (outcome.kind !== 'ERROR') {
        this.throttleStreaks.delete(`${run.id}|${host}`); // 응답을 정상으로 받았다 — 연속이 끊긴다.
      }
      await noteSeedResult(doc, verdict);

      this.logger.log(kbLogLine({ host, path: urlPath(doc.url), code: outcome.kind }));
    }

    // 프런티어가 아직 남아 있으면(예산 소진·호스트 간격 대기·중지 요청) 여기서 멈추고 다음 tick에
    // DB 프런티어로 이어서 간다(R-5) — "소진"으로 오판해 크롤을 조기 종결하지 않는다.
    if (!frontierExhausted && !maxPagesReached) return 'CONTINUE';

    // 프런티어 소진(또는 상한 도달) — 크롤 종결. 조각 실행이 여러 tick에 걸쳐 이어졌을 수 있으므로
    // 적재 대상·집계는 **DB에서 다시 모은다**(tick 지역 변수는 tick 경계를 넘어 살아남지 못한다).
    // 종결 직전에 임대를 한 번 더 확인한다 — 그 사이 중지됐으면 적재 작업을 만들지 않고 물러난다.
    if (!(await this.store.renewCrawlLease(run.id, token, new Date()))) return 'LOST';

    // [pass 5 · RG-1 · AC-KB3-4] 시작 주소가 전부 실패(5xx·연결 실패·차단)했다면 사이트 단위 장애일 수 있다 — 이번에 다시 발견하지 못한
    // 기존 문서를 "없어짐"으로 세면 장애가 2회만 이어져도 멀쩡한 문서가 GONE·정리 필요가 된다. 삭제 감지 스윕·강등·적재를 건너뛰고
    // `FAILED`로 끝낸다. 허용 호스트 전부의 robots를 못 읽었다면 `ROBOTS_UNREACHABLE`, 아니면 `ALL_SEEDS_UNREACHABLE`.
    // [pass 6 · M-8 · RG-20①] 요청 없이 제외한 시작 주소(원본 파일 전달 꺼짐)만 있으면 판정 대상이 아니다(중립) — 도달한 시작 주소가 없고 요청을 보낸 시작 주소가
    // 실패했거나(또는 시작 주소 자체가 없을 때)만 미도달이다.
    const finishRow = await this.store.findRun(run.id);
    const finalSeed = readSeedState(finishRow?.counts);
    let unreachableCode: 'ALL_SEEDS_UNREACHABLE' | 'ROBOTS_UNREACHABLE' | null = null;
    if (!maxPagesReached && !finalSeed.reached && (finalSeed.failed || !finalSeed.neutral)) {
      const throttled = this.throttleAborted.get(run.id);
      const allRobotsAborted = source.allowedHosts.length > 0 && source.allowedHosts.every((h) => abortedHosts.has(h) && !throttled?.has(h));
      unreachableCode = allRobotsAborted ? 'ROBOTS_UNREACHABLE' : 'ALL_SEEDS_UNREACHABLE';
    }

    // [pass 9 · L-1] 강등 판정은 삭제 감지 스윕보다 **먼저** 한다 — 강등된 실행(신뢰할 수 없는 크롤)에서 이번에 다시 발견되지 않은 적재 문서의 `missingStreak`을 올리거나 요약 건수(`counts.missing`)를 오염시키지 않는다.
    // 판정 입력(관측 분포 · 신규 수)은 스윕과 무관하다 — 스윕은 `seenRunId ≠ 실행`인 행만 바꾸고 입력은 `seenRunId = 실행`인 행만 센다.
    const observations = await this.store.countRunObservations(source.id, run.id);
    // [pass 8 · RG-21 · pass 9 · H-1] 인증 벽 판정은 조각 지역 집계가 아니라 **실행 전체의 DB 분포**(`KbDocument.observedHash`)로 한다 — 여러 tick·인스턴스에 걸친 크롤도, 200 로그인 폼(NEW·CHANGED)도,
    // 로그인 경로로의 3xx 수렴(`RL:`)·범위 밖 로그인(SSO) 3xx 수렴(`X:`)도 같은 분포에 잡힌다. 분모는 방문한 HTML 행 전체(304 포함)다 — 변경 없는 정상 문서가 분포를 희석한다.
    const observedHashes = await this.store.countObservedHashDistribution(source.id, run.id);
    const demotedReason = unreachableCode
      ? null
      : evaluateRunGuards({
          priorActiveIngestedCount: priorActiveIngested,
          addedCount: observations.added,
          observedHtmlCount: observedHashes.visited,
          hashedHtmlCount: observedHashes.hashed,
          sameHashHtmlMaxCount: observedHashes.max,
          // [pass 10 · RG-23] 승인으로 시작된 SYNC(`trigger = APPROVAL` — `approveIngest`만 만든다)는 새로 비율 판정만 면제한다. 실행 행의 기존 `trigger` 열을 읽으므로 계약·스키마 변경이 없다.
          approvedByUser: run.kind === 'SYNC' && finishRow?.trigger === 'APPROVAL',
        });

    // [R-21 · EX-KB-4] 삭제 감지 — SYNC·FULL_RESEND ∧ 상한 미도달 ∧ 중단 호스트 제외일 때만, 이번
    // 실행에서 다시 발견되지 않은 기존 문서를 "NOT_REDISCOVERED"로 관측한다. 링크를 확인하지 못한 부모(304·오류·차단)의 자식은 크롤 중에
    // 이어 방문했으므로(`carryChildren`, pass 6 · H-2) 여기서 남은 것은 실제로 어디서도 발견되지 않은 문서다.
    // 이 스윕이 바꾼 문서는 `seenRunId ≠ 실행`이라 DB 재집계(`countRunOutcomes`)에 잡히지 않는다 — 몫을 여기서 센다.
    let sweep = { missing: 0, gone: 0, needsCleanup: 0 };
    if (run.kind !== 'PREVIEW' && !maxPagesReached && !unreachableCode && !demotedReason) {
      const saved = readSavedSweep(finishRow?.counts);
      if (saved) {
        sweep = saved; // [pass 6 · RG-20⑤] 종결 도중 실패해 다시 종결하는 경우 — 이미 센 몫을 이어받고 스윕을 다시 하지 않는다(요약 건수가 줄지 않는다).
      } else {
        // 실행 시작 뒤에 바뀐 행은 뺀다 — 종결 도중 실패해 조각이 다시 종결을 시도해도 같은 행을 두 번 세지 않는다(멱등).
        const stale = await this.store.findStaleDocuments(source.id, run.id, finishRow?.startedAt ?? null);
        for (const d of stale) {
          if (abortedHosts.has(urlHostname(d.url))) continue;
          const next = nextMissingState({ missingStreak: d.missingStreak, state: d.state, cleanupReason: d.cleanupReason }, 'NOT_REDISCOVERED', { everIngested: !!d.lastIngestedAt, countable: true });
          await this.store.applyMissingUpdate(d.id, next);
          if (next.state === 'GONE' && d.state !== 'GONE') sweep.gone += 1;
          else if (next.state === 'ACTIVE' && next.missingStreak > 0) sweep.missing += 1;
          if (next.cleanupReason && !d.cleanupReason) sweep.needsCleanup += 1;
        }
        await this.store.saveSweepCounts(run.id, sweep);
      }
    }

    // 미리보기는 사람이 결과를 보고 승인하는 단계라 인증 벽 의심을 실행 이력에 **기록만** 한다(화면 경고) — 소스 승인 해제(강등)는 적재를 만드는 SYNC·FULL_RESEND에만 한다.
    const recordOnly = demotedReason === 'AUTH_WALL' && run.kind === 'PREVIEW';
    // [pass 4 · 위반 6] 종결 집계를 전부 0으로 덮어쓰지 않는다 — 행 단위로 관측된 값은 DB에서 다시 세고,
    // 행이 없는 `outOfScopeLinks`는 크롤 중 실행 행에 누적해 둔 값을 이어받는다.
    const outcomes = await this.store.countRunOutcomes(source.id, run.id);
    const outOfScopeLinks = readOutOfScopeLinks(finishRow?.counts);
    const countsJson = JSON.stringify({
      discovered: outcomes.discovered,
      visited: outcomes.visited,
      unchanged: observations.unchanged,
      added: observations.added,
      changed: observations.changed,
      missing: outcomes.missing + sweep.missing,
      gone: outcomes.gone + sweep.gone,
      needsCleanup: outcomes.needsCleanup + sweep.needsCleanup,
      piiMasked: outcomes.piiMasked,
      excluded: outcomes.excluded,
      outOfScopeLinks,
    });
    const abortedJson = JSON.stringify([...abortedHosts]);

    if (unreachableCode) {
      await this.finishCrawl(source.id, run.id, { status: 'FAILED', counts: countsJson, maxPagesReached, abortedHosts: abortedJson, failureCode: unreachableCode, crawlFinishedAt: new Date() });
      return 'DONE';
    }

    if (demotedReason) {
      // [pass 6 · M-1] 강등은 종결 CAS와 **같은 트랜잭션**에서 반영한다(`finishCrawlAndRelease`) — 그 전에 하면 중지된 실행이 소스 승인을 해제한다.
      await this.finishCrawl(source.id, run.id, { status: 'SUCCEEDED', counts: countsJson, maxPagesReached, abortedHosts: abortedJson, demotedReason, crawlFinishedAt: new Date() }, { demoteReview: !recordOnly });
      return 'DONE';
    }

    // 적재 전제(§5.7)가 없으면 승인된 소스여도 적재 단계를 만들지 않고 실행을 `FAILED`로 끝낸다 — 그렇게 하지 않으면
    // 대기 작업이 영영 제출되지 못한 채 실행이 INGESTING에 머문다. 크롤 결과는 남고 해시는 갱신되지 않아 다음 실행이 다시
    // "바뀜"으로 잡는다. PREVIEW는 외부 RAG 호출이 0이라 해당 없다.
    if (run.kind !== 'PREVIEW') {
      const failure = !this.config.get<string>('KB_INGEST_TRANSPORT_ACK') ? 'INGEST_NOT_ACKNOWLEDGED' : !this.config.get<string>('RAG_BASE_URL') ? 'RAG_NOT_CONFIGURED' : null;
      if (failure) {
        await this.finishCrawl(source.id, run.id, { status: 'FAILED', counts: countsJson, maxPagesReached, abortedHosts: abortedJson, failureCode: failure, crawlFinishedAt: new Date() });
        return 'DONE';
      }
    }

    // PREVIEW는 감지만 한다 — 적재 작업을 만들지 않는다(§9.8 · 첫 회 미리보기).
    let created = 0;
    if (run.kind === 'FULL_RESEND') {
      const all = await this.store.findFullResendDocuments(source.id, run.id);
      if (all.length > 0) {
        const lane = decideIngestLane({ jobCountInRun: all.length, isFullResend: true, isFirstIngestForSource: false });
        created = await this.store.createIngestJobsBulk(all.map((c) => ({ runId: run.id, sourceId: source.id, documentId: c.id, lane, reason: 'FULL_RESEND' as const })));
      }
    } else if (run.kind === 'SYNC') {
      const candidates = await this.store.findIngestCandidates(source.id, run.id);
      if (candidates.length > 0) {
        const isFirst = !(await this.store.hasEverIngested(source.id)); // [pass 10 · RG-23] 분모가 ACTIVE만 세도 "첫 적재"는 적재 이력 전체로 판정한다.
        const lane = decideIngestLane({ jobCountInRun: candidates.length, isFullResend: false, isFirstIngestForSource: isFirst });
        created = await this.store.createIngestJobsBulk(candidates.map((c) => ({ runId: run.id, sourceId: source.id, documentId: c.id, lane, reason: c.observedChange })));
      }
    }
    // 종결 도중 실패해 조각이 다시 종결하는 경우(이미 만든 작업은 "문서당 진행 중 적재 1건"이라 새로 만들어지지 않는다)에도 실행이 적재 단계로
    // 넘어가야 한다 — 이번에 만든 수가 0이어도 이 실행의 작업이 이미 있으면 INGESTING이다.
    const totalJobs = created > 0 ? created : Object.values(await this.store.countJobsByRun(run.id)).reduce((a, b) => a + b, 0);

    const status = totalJobs > 0 ? 'INGESTING' : 'SUCCEEDED';
    await this.finishCrawl(source.id, run.id, { status, counts: countsJson, maxPagesReached, abortedHosts: abortedJson, crawlFinishedAt: new Date() });
    return 'DONE';
  }

  /**
   * 크롤 종결 + 소스 선점 해제(한 트랜잭션). [pass 6 · RG-19] 종결 CAS에 졌으면(그 사이 중지 · 다른 인스턴스가 먼저 끝냄) 방금 만든 PENDING 작업을 정리한다 —
   * 정리하지 않으면 중지된 실행의 작업이 남아 외부로 제출될 수 있다. 실행이 아직 진행 중(다른 인스턴스가 이어받음)이면 그쪽 작업이라 건드리지 않는다.
   */
  private async finishCrawl(sourceId: string, runId: string, data: Parameters<KbRunStore['finishCrawl']>[1], opts?: { demoteReview: boolean }): Promise<void> {
    const ok = await this.sourcesService.finishCrawlAndRelease(sourceId, runId, data, opts);
    if (!ok) await this.store.cancelPendingJobsOfTerminatedRun(runId);
    this.forgetRun(runId);
  }

  /** 크롤을 시작하지 못하는 실행 수준 실패 — 기록된 집계는 그대로 두고 실행을 끝내 소스의 선점을 푼다(종결·해제는 한 트랜잭션). */
  private async failRun(run: RunRow, source: SourceConfig, failureCode: 'SECRET_MISSING'): Promise<void> {
    const row = await this.store.findRun(run.id);
    await this.sourcesService.finishCrawlAndRelease(source.id, run.id, { status: 'FAILED', counts: row?.counts ?? '{}', maxPagesReached: false, abortedHosts: '[]', failureCode, crawlFinishedAt: new Date() });
  }

  private async finalizeMissing(
    doc: { id: string; missingStreak: number; state: string; cleanupReason: string | null; lastIngestedAt: Date | null },
    observation: MissingObservation,
  ): Promise<void> {
    const next = nextMissingState(
      { missingStreak: doc.missingStreak, state: doc.state as 'ACTIVE' | 'GONE' | 'EXCLUDED', cleanupReason: doc.cleanupReason },
      observation,
      { everIngested: !!doc.lastIngestedAt, countable: true },
    );
    await this.store.markVisited(doc.id, {
      state: next.state,
      excludeReason: observation === 'ROBOTS_BLOCKED' ? ('ROBOTS' as KbExcludeReason) : undefined,
      cleanupReason: next.cleanupReason as KbCleanupReason | null,
      missingStreak: next.missingStreak,
      observedChange: null,
    });
  }

  /** 이 문서를 "다시 봤다(200·304)"고 할 때의 정리 표시 — 사라졌다 돌아온 문서의 `GONE` 표시는 풀린다(`null`), 다른 사유는 남는다(RG-10). */
  private seenOkCleanupReason(doc: DocRow): string | null {
    return nextMissingState({ missingStreak: doc.missingStreak, state: doc.state as 'ACTIVE' | 'GONE' | 'EXCLUDED', cleanupReason: doc.cleanupReason }, 'SEEN_OK', { everIngested: !!doc.lastIngestedAt, countable: true }).cleanupReason;
  }

  /**
   * 호스트 간격을 지킨다 — 남은 지연이 조각 예산 안이면 조각 안에서 기다린 뒤(중지 요청을 확인하며) `true`, 예산을 넘거나 중지되면 `false`(호출부가 조각을 끝내고 다음 조각에서
   * 이어간다). [pass 6 · RG-17] 예전에는 페이서가 준비되지 않으면 곧바로 조각을 끝내 실행당 tick마다 URL 약 1개만 처리했다.
   * [pass 9 · M-4] 리다이렉트 홉도 예외가 아니다 — 예전(pass 7 · N-1)에는 홉이면 조각 예산을 넘겨서라도 기다려(강제 대기) 문서 1건이 간격 × 홉 수(최대 약 900초)만큼 tick 전체를 점유했다.
   * 진행 보장(라이브락 방지)은 이제 홉 진행 상태 저장(`redirectResume`)이 맡는다 — 미룬 문서는 다음 조각에 저장된 홉에서 이어간다.
   */
  private async waitForHost(host: string, ctx: CrawlCtx): Promise<boolean> {
    for (;;) {
      if (ctx.stopping()) return false;
      const now = this.pacer.now();
      const wait = this.pacer.msUntilReady(host, now);
      if (wait <= 0) return true;
      if (now + wait > ctx.deadline) return false;
      if (!(await ctx.renewLease(LEASE_RENEW_WAIT_GAP_MS))) return false; // 오래 기다리는 동안에도 임대를 잃지 않고, 중지됐으면 대기를 마친 뒤 요청을 보내지 않는다.
      await this.pacer.sleep(Math.min(wait, SLEEP_SLICE_MS));
    }
  }

  /** 이 호스트의 요청 간격(ms) = max(소스 간격, robots `Crawl-delay`) — robots를 이미 읽었을 때만 Crawl-delay를 반영한다. */
  private hostIntervalMs(url: string, source: SourceConfig): number {
    const cached = this.robotsCache.get(robotsKey(httpOrHttpsScheme(url), urlHostPort(url)));
    const delayMs = cached && cached.rules !== 'ALLOW_ALL' ? (cached.rules.crawlDelaySec ?? 0) * 1000 : 0;
    // [pass 7 · N-1] 서버 쪽 실효 상한 — 소스 간격·Crawl-delay가 커도 300초까지만(계약 변경 없음).
    return Math.min(MAX_HOST_INTERVAL_MS, Math.max(source.minIntervalMs, delayMs));
  }

  /**
   * 요청 하나하나(페이지 · 리다이렉트 홉 · robots.txt)가 거치는 훅 — 요청 직전에 (홉이면 robots 재확인 후) 호스트 간격을 기다리고 페이서를 잡으며, 응답 직후 풀어 준다.
   * [pass 6 · RG-16] 홉마다 robots 재확인과 페이싱, [M-3] robots 요청도 페이싱. 429·503 응답이면 다음 요청까지 `Retry-After`(없으면 간격×4 · 최대 60초)를 기다린다.
   */
  private requestHooks(ctx: CrawlCtx, opts: { robotsOnHops: boolean; forRobots?: boolean }): Pick<FollowOptions, 'beforeRequest' | 'afterRequest'> {
    return {
      beforeRequest: async (url, hop): Promise<FollowResult | null> => {
        const host = urlHostname(url);
        if (hop > 0 && opts.robotsOnHops) {
          if (ctx.abortedHosts.has(host)) return { kind: 'ERROR', outcome: 'NETWORK_ERROR' };
          const robots = await this.getRobots(url, ctx.source, ctx);
          if (robots === 'DEFERRED') return { kind: 'DEFERRED' };
          if (robots === 'ABORT_HOST') {
            await ctx.abortHost(host, 'ROBOTS');
            return { kind: 'ERROR', outcome: 'NETWORK_ERROR' };
          }
          if (robots !== 'ALLOW_ALL' && !robots.isAllowed(pathAndQuery(url))) return { kind: 'VETOED', reason: 'ROBOTS_BLOCKED' };
        }
        if (!(await this.waitForHost(host, ctx))) return { kind: 'DEFERRED' };
        // [pass 9 · L-3] 요청 직전 임대 갱신은 **항상** 한다(간격 생략 없음) — 실패(중지·인수)면 이 요청을 보내지 않는다(AC-KB5-4). 갱신에 성공한 직후 중지되는 경합은 남지만 그 구간은 DB 왕복 1회다.
        if (!(await ctx.renewLease(0))) return { kind: 'DEFERRED' };
        this.pacer.acquire(host);
        return null;
      },
      afterRequest: (url, _hop, result) => {
        const host = urlHostname(url);
        // robots.txt 요청의 간격은 소스 간격이다(그 호스트의 Crawl-delay는 이 파일 안에 있어 아직 모른다) — 실효 상한(300초)을 넘지 않는다(N-1).
        const base = opts.forRobots ? Math.min(ctx.source.minIntervalMs, MAX_HOST_INTERVAL_MS) : this.hostIntervalMs(url, ctx.source);
        // 429·503 지연(최대 60초)이 정상 간격(클램프된 최대 300초)보다 짧아지지 않게 한다(예전 `throttleDelayMs`는 정상 간격이 60초를 넘으면 60초로 깎았다).
        const delay = result.kind === 'RESPONSE' && (result.status === 429 || result.status === 503) ? Math.max(base, throttleDelayMs(result.headers['retry-after'], base, new Date())) : base;
        this.pacer.release(host, this.pacer.now(), delay);
      },
    };
  }

  /** 저장된 리다이렉트 진행 상태가 지금의 문서에 유효하면 돌려준다 — 시작 URL이 다르거나 오래됐으면 버리고 `undefined`. */
  private takeResume(key: string, startUrl: string): FollowResume | undefined {
    const state = this.redirectResume.get(key);
    if (!state) return undefined;
    if (state.startUrl !== startUrl || this.pacer.now() - state.savedAt > REDIRECT_RESUME_TTL_MS) {
      this.redirectResume.delete(key);
      return undefined;
    }
    return { url: state.url, hop: state.hop, visited: state.visited };
  }

  private async visitOne(doc: DocRow, ctx: CrawlCtx): Promise<VisitOutcome> {
    const { source, run } = ctx;
    const headers: Record<string, string> = {};
    if (doc.etag) headers['if-none-match'] = doc.etag;
    if (doc.lastModified) headers['if-modified-since'] = doc.lastModified;
    this.applyAuthHeader(headers, source, doc.url);

    // HTML은 2MB에서 스트림을 끊는다(§7.3) — 파일은 소스의 `maxFileBytes`(서버 상한으로 잘린 값)다. [pass 7 · N-4·N-6] 요청 URL(홉)마다 정한다 — 파일이면 타임아웃 ×4(설계 §6.8 · 적재기와 같다),
    // 리다이렉트로 HTML URL이 파일로(또는 반대로) 넘어가도 그 홉의 종류 기준 상한을 쓴다.
    const maxBytes = (url: string): number => (isFileUrl(url) ? source.maxFileBytes : Math.min(source.maxFileBytes, HTML_MAX_BYTES));
    const timeoutMs = (url: string): number => this.timeoutMs() * (isFileUrl(url) ? 4 : 1);
    // [pass 9 · M-4] 앞 조각이 홉 사이에서 미룬 문서면 저장된 홉에서 이어간다(홉 0을 다시 요청하지 않는다). 유효하지 않은 상태(다른 URL · 만료)는 버리고 홉 0부터 한다.
    const resumeKey = `${run.id}|${doc.id}`;
    const resume = this.takeResume(resumeKey, doc.url);
    const res = await fetchFollowingRedirects(
      this.fetcher,
      {
        url: doc.url,
        resume,
        allowedHosts: source.allowedHosts,
        allowedOrigins: source.allowedOrigins,
        maxBytes,
        timeoutMs,
        // 조건부 요청 헤더는 첫 요청에만 — 리다이렉트 대상은 다른 문서라 이 문서의 검증자를 보내면 안 된다. 인증 헤더는 시작 호스트로 가는 요청에만(자격증명 누출 방지).
        headersFor: (url, hop) => {
          if (hop === 0) return headers;
          const hopHeaders: Record<string, string> = {};
          // [pass 10 · RG-24① · pass 12 · RG-26] 허용 출처와 정확히 일치하고 이 문서의 시작 URL과 같은 host:port일 때만 — 같은 머신의 다른 포트 서비스로 자격증명을 보내지 않는다.
          this.applyAuthHeader(hopHeaders, source, url, doc.url);
          return hopHeaders;
        },
      },
      { allowQueryUrls: source.allowQueryUrls, scope: source, ...this.requestHooks(ctx, { robotsOnHops: true }) },
    );

    if (res.kind === 'DEFERRED') {
      // 홉 ≥ 1에서 미뤘다면 진행 상태를 남겨 다음 조각이 이어가게 한다 — 홉 0에서 미룬 것(아직 아무 요청도 나가지 않았다)은 남길 것이 없다.
      if (res.resume) setBounded(this.redirectResume, resumeKey, { ...res.resume, startUrl: doc.url, savedAt: this.pacer.now() }, MAX_TRACKED_RESUMES);
      else this.redirectResume.delete(resumeKey);
      return { kind: 'DEFERRED' };
    }
    this.redirectResume.delete(resumeKey); // 응답을 받았다 — 이 문서의 진행 상태는 끝났다.
    if (res.kind === 'VETOED') {
      // 리다이렉트 대상이 robots로 막혔다 — 직접 막힌 문서와 같이 제외한다(사이트는 응답했다).
      ctx.verdict = 'REACHED';
      await this.finalizeMissing(doc, 'ROBOTS_BLOCKED');
      await this.carryChildren(doc, ctx);
      return { kind: 'EXCLUDED' };
    }
    if (res.kind === 'REDIRECT_OUT_OF_SCOPE') {
      // [pass 6 · RG-16] 범위 밖·하향·4번째 hop·순환 — 일시 오류(TRANSIENT)가 아니라 제외다(요청은 이미 나가지 않았다). 사이트는 응답했으므로 시작 주소 도달로 센다.
      ctx.verdict = 'REACHED';
      // [pass 8 · RG-21] 여러 URL이 같은 범위 밖 목적지(SSO 로그인 등)로 넘어가면 같은 지문(`X:`)이 쌓여 인증 벽 판정에 잡힌다.
      await this.finalizeExcluded(doc, 'REDIRECT_OUT_OF_SCOPE' as KbExcludeReason, undefined, res.target ? outOfScopeTargetHash(res.target) : undefined);
      await this.carryChildren(doc, ctx);
      return { kind: 'EXCLUDED' };
    }
    if (res.kind === 'ERROR' && res.outcome === 'RESPONSE_TOO_LARGE') {
      // 일시 오류가 아니다 — 다시 받아도 같다. 크기 제외로 기록한다(파일 상한을 넘은 파일 포함).
      ctx.verdict = 'REACHED';
      await this.finalizeExcluded(doc, 'SIZE' as KbExcludeReason);
      await this.carryChildren(doc, ctx);
      return { kind: 'EXCLUDED' };
    }
    if (res.kind === 'BLOCKED' || res.kind === 'ERROR') {
      ctx.verdict = 'FAILED';
      await this.finalizeMissing(doc, 'TRANSIENT');
      await this.carryChildren(doc, ctx);
      return { kind: 'ERROR' };
    }
    // 429·503은 기록하지 않고 호출부(processLoop)가 재시도·호스트 중단을 정한다(§6.8 · RG-4).
    if (res.status === 429 || res.status === 503) return { kind: 'THROTTLED', retryAfter: res.headers['retry-after'] };
    if (res.status === 304) {
      // 조건부 요청의 정상 응답 — 이 문서는 그대로다. 본문을 받지 않아 링크를 다시 확인하지 못했으니 지난번에 알던 자식들을 이어 방문한다(pass 6 · H-2).
      ctx.verdict = 'REACHED';
      await this.finalizeMissing(doc, 'SEEN_OK');
      await this.carryChildren(doc, ctx);
      return { kind: 'UNCHANGED' };
    }
    if (res.status === 404 || res.status === 410) {
      ctx.verdict = 'REACHED';
      await this.finalizeMissing(doc, 'GONE_HTTP');
      return { kind: 'GONE' };
    }
    if (res.status < 200 || res.status >= 300) {
      ctx.verdict = 'FAILED';
      await this.finalizeMissing(doc, 'TRANSIENT');
      await this.carryChildren(doc, ctx);
      return { kind: 'ERROR' };
    }
    ctx.verdict = 'REACHED';

    // [pass 6 · RG-16] 리다이렉트를 따라 받은 문서는 **최종 URL** 행에 기록한다(원래 URL 행은 방문 표시만 — 같은 문서를 두 번 적재하지 않는다). 상대 링크도 최종 URL 기준이다.
    let subject = doc;
    // [pass 11 · M-B] 로그인 신호가 있는 목적지에 리다이렉트로 도달한 목적지 행은 본문 해시 대신 `RD:` 표식을 남긴다 — 원래 행(`RL:`)이 이미 분포에 세어지므로 이중으로 세지 않는다.
    let loginTargetHash: string | undefined;
    if (res.finalUrl !== doc.url) {
      const adopted = await this.adoptRedirectTarget(doc, res.finalUrl, ctx);
      // [pass 8 · RG-21] 원래 행에는 "최종 URL로 수렴했다"는 지문(`R:`)을 남긴다 — 여러 문서가 같은 로그인 페이지로 넘어가면 최종 URL 행 1건만 본문을 관측해도 분포에 잡힌다.
      const convergedTo = redirectOriginHash(res.finalUrl, source.allowQueryUrls);
      if (adopted.kind === 'TYPE') {
        await this.finalizeExcluded(doc, 'TYPE' as KbExcludeReason, undefined, convergedTo);
        return { kind: 'EXCLUDED' };
      }
      // 원래 URL은 방문했다(응답을 받았고 최종 URL로 넘겼다) — 적재 후보가 아니다.
      await this.store.markVisited(doc.id, { state: 'ACTIVE', missingStreak: 0, cleanupReason: this.seenOkCleanupReason(doc), observedChange: null, observedHash: convergedTo });
      if (adopted.kind === 'DONE') return { kind: 'UNCHANGED' }; // 최종 URL은 이번 실행에서 이미 처리됐다.
      subject = adopted.doc;
      if (hasLoginSignal(res.finalUrl)) loginTargetHash = redirectLoginTargetHash(res.finalUrl);
    }

    // [pass 7 · N-6] 리다이렉트로 종류가 바뀔 수 있다 — 최종 응답이 문서 파일인데 원본 파일 전달이 꺼진 소스면 요청 전 판정(`RAW_FILE_OFF`)과 같이 제외한다(적재 후보 아님).
    if (subject.kind !== 'HTML' && !source.allowRawFileIngest) {
      await this.finalizeExcluded(subject, 'RAW_FILE_OFF' as KbExcludeReason);
      return { kind: 'EXCLUDED' };
    }
    // 반대로 문서 파일 URL이 HTML로 리다이렉트됐으면 HTML 상한(2MB)을 적용한다(홉 요청 상한도 같지만 상한을 지키지 않는 전송 구현·시험 대역에 대비한 방어).
    if (subject.kind === 'HTML' && res.body.length > HTML_MAX_BYTES) {
      await this.finalizeExcluded(subject, 'SIZE' as KbExcludeReason);
      await this.carryChildren(subject, ctx);
      return { kind: 'EXCLUDED' };
    }

    if (subject.kind === 'HTML') {
      const decoded = decodeBody(res.body, res.contentType ?? null);
      // [R1 리뷰 H-2] 추출(타임아웃·작업 스레드 크래시)은 이 문서 하나만의 실패로 가둔다(§7.2·§7.3)
      // — 예외를 그대로 흘려보내면 이 실행(processLoop)은 물론 같은 tick의 다른 실행까지 전부
      // 멈추고, 문서는 QUEUED로 남아 다음 tick에 같은 실패를 무한 반복한다. 단, 워커 진입점 자체가
      // 없는 전역 설정 오류는 "이 문서가 안전하지 않다"로 위장하지 않고 그대로 올려보낸다(모든
      // 문서가 조용히 제외되는 사고 방지 — 위쪽 실행 단위에서 격리한다).
      let extracted: Awaited<ReturnType<KbExtractorPort['extract']>>;
      try {
        extracted = await this.extractor.extract({ kind: 'HTML', html: decoded, noisePatterns: source.noisePatterns, piiMask: source.piiMask, piiMaskMode: 'PARTIAL' });
      } catch (e) {
        if (e instanceof WorkerEntryMissingError) throw e;
        await this.finalizeExcluded(subject, 'FILE_UNSAFE' as KbExcludeReason);
        await this.carryChildren(subject, ctx); // 링크를 얻지 못했다.
        return { kind: 'EXCLUDED' };
      }
      // [pass 8 · RG-21] 본문을 추출한 모든 경로(NEW·CHANGED·UNCHANGED·NO_BODY·NOINDEX)가 같은 해시를 남긴다 — 짧은 로그인 폼(NO_BODY)·noindex 로그인 페이지도 "한 곳으로 수렴"에 잡힌다.
      const contentHash = sha256Hex(extracted.normalizedText);
      // [pass 9 · H-1] 본문이 비어 있으면 관측 지문을 남기지 않는다(이미지·iframe 전용 페이지가 전부 같은 `sha256('')`으로 분포를 지배하지 않게).
      const observedHash = loginTargetHash ?? bodyObservedHash(extracted.normalizedText);
      // 메타 `robots`와 `X-Robots-Tag` 응답 헤더 둘 다 본다(RG-11).
      const robotsTag = parseXRobotsTag(res.headers['x-robots-tag'], this.productToken());
      const follow = !(extracted.nofollow || robotsTag.nofollow);
      // [pass 6 · M-5] noindex(적재 제외)와 nofollow(링크 미추종)는 별개다 — noindex만 있는 페이지도 링크는 따라간다.
      if (extracted.noindex || robotsTag.noindex) {
        await this.finalizeExcluded(subject, 'NOINDEX' as KbExcludeReason, undefined, observedHash);
        if (follow) await this.followLinks(subject, ctx, extracted.links ?? []);
        return { kind: 'EXCLUDED' };
      }

      // 추출 텍스트가 200자 미만이면 본문이 없는 페이지(스크립트로 그리는 사이트·목차)다 — 적재하지 않고 제외하되 링크는 계속 따라간다(EX-KB-6).
      if (extracted.flags.includes('NO_BODY')) {
        await this.finalizeExcluded(subject, 'NO_BODY' as KbExcludeReason, undefined, observedHash);
        if (follow) await this.followLinks(subject, ctx, extracted.links ?? []);
        return { kind: 'EXCLUDED' };
      }

      const format = this.config.get<string>('KB_HTML_INGEST_FORMAT') ?? 'DOCX';
      const ingestFingerprint = computeIngestFingerprint({ contentHash, format, piiMask: source.piiMask, piiMaskMode: 'PARTIAL' });
      const decision = decideChange(subject, { contentHash, ingestFingerprint, textLength: extracted.normalizedText.length });
      // R-24 — 검증자는 "마지막으로 성공 적재한 내용"과 짝이다. UNCHANGED로 확인됐을 때만 갱신한다
      // (NEW·CHANGED는 적재 성공 시점에 succeedJob()이 갱신한다 — 304 함정 방지).
      await this.store.markVisited(subject.id, {
        state: 'ACTIVE',
        missingStreak: 0,
        cleanupReason: this.seenOkCleanupReason(subject), // 사라졌다 돌아온 페이지의 GONE 표시 해제(RG-10)
        title: extracted.title,
        observedChange: decision.change,
        observedPiiMasked: extracted.piiMaskedCount,
        observedHash,
        ...(decision.change === 'UNCHANGED' ? { etag: res.headers.etag ?? null, lastModified: res.headers['last-modified'] ?? null } : {}),
      });

      if (follow) await this.followLinks(subject, ctx, extracted.links ?? []);

      if (decision.change === 'NEW' || decision.change === 'CHANGED') {
        return { kind: 'ADDED_TO_INGEST', reason: decision.change };
      }
      return { kind: 'HTML_VISITED' };
    }

    // 파일 종류(PDF·DOCX·XLSX·PPTX) — 여기까지 왔다면 원본 파일 전달이 켜진 소스다(꺼져 있으면 processLoop가 요청 없이 제외한다).
    if (res.body.length > source.maxFileBytes) {
      await this.finalizeExcluded(subject, 'SIZE' as KbExcludeReason);
      return { kind: 'EXCLUDED' };
    }
    // [pass 5 · RG-8] 원본 바이트를 그대로 보내기 전에 작업 스레드에서 사전 검사한다(§7.3 · ADR-0044 §10) — 압축 폭탄·매크로·암호 문서는
    // 외부로 보내지 않고 제외하고, 개인정보 형식 건수를 센다. 원본에는 마스킹이 없으므로 거버넌스 ON이면 1건 이상인 파일은 제외한다(R-17).
    const inspection = await inspectRawFile(this.extractor, subject.kind, res.body, { governanceOn: this.governanceOn() });
    if (!inspection.ok) {
      await this.finalizeExcluded(subject, inspection.reason as KbExcludeReason);
      return { kind: 'EXCLUDED' };
    }
    if (this.governanceOn() && inspection.piiMaskedCount > 0) {
      // [pass 6 · RG-20②] 제외해도 발견한 개인정보 건수는 실행 요약("개인정보 N건")에 남긴다.
      await this.finalizeExcluded(subject, 'PII_IN_RAW_FILE' as KbExcludeReason, inspection.piiMaskedCount);
      return { kind: 'EXCLUDED' };
    }
    const contentHash = sha256Hex(res.body);
    const decision = decideChange(subject, { contentHash, ingestFingerprint: contentHash, byteSize: res.body.length });
    await this.store.markVisited(subject.id, {
      state: 'ACTIVE',
      missingStreak: 0,
      cleanupReason: this.seenOkCleanupReason(subject),
      observedChange: decision.change,
      observedPiiMasked: inspection.piiMaskedCount,
      ...(decision.change === 'UNCHANGED' ? { etag: res.headers.etag ?? null, lastModified: res.headers['last-modified'] ?? null } : {}),
    });
    if (decision.change === 'NEW' || decision.change === 'CHANGED') {
      return { kind: 'ADDED_TO_INGEST', reason: decision.change };
    }
    return { kind: 'HTML_VISITED' };
  }

  /**
   * [pass 6 · RG-16] 리다이렉트 최종 URL을 이 실행의 프런티어(같은 깊이 · 부모 = 리다이렉트한 문서)에 올려 문서 행을 얻는다. 이미 이번 실행에서 처리한 문서면 `DONE`,
   * 대상이 아닌 형식이면 `TYPE`. 받아 둔 응답 본문은 이 행에 바로 기록하므로 같은 문서를 다시 받지 않는다.
   */
  private async adoptRedirectTarget(doc: DocRow, finalUrl: string, ctx: CrawlCtx): Promise<{ kind: 'SUBJECT'; doc: DocRow } | { kind: 'DONE' } | { kind: 'TYPE' }> {
    const { source, run } = ctx;
    const normalized = normalizeUrl(finalUrl, { allowQueryUrls: source.allowQueryUrls });
    const kind = normalized ? detectKind(normalized, undefined, source.fileTypes) : null;
    if (!normalized || !kind) return { kind: 'TYPE' };
    const uh = computeUrlHash(normalized);
    await this.store.seedFrontier(source.id, run.id, [
      { url: normalized, urlHash: uh, kind, externalFileName: buildExternalFileName(source.id, normalized, extFromKind(kind)), depth: doc.depth, parentId: doc.id },
    ], source.maxPages);
    const row = await this.store.findDocumentByUrlHash(source.id, uh);
    if (!row) return { kind: 'DONE' }; // 행 수 상한(maxPages)에 막혀 넣지 못했다(N-3).
    if (row.seenRunId !== run.id) return { kind: 'DONE' }; // 기존 행인데 상한 때문에 이번 실행에 올리지 못했다 — 이 실행의 기록으로 남기지 않는다.
    if (row.visitState === 'VISITED') return { kind: 'DONE' };
    return { kind: 'SUBJECT', doc: row as DocRow };
  }

  /**
   * [pass 6 · H-2] 링크를 이번 실행에서 확인하지 못한 문서(304 · 오류 · 차단 · 제외 · 추출 실패)의 자식을 지난번에 알던 대로 이어 프런티어에 넣는다 — 방문해서 각자 200·304·404를
   * 판정한다. 이렇게 하지 않으면 자식이 "다시 발견되지 않음"으로 세어져 연속 2회에 멀쩡해도 GONE이 되고, 안 바뀐 부모 아래의 변경된 자식은 영영 다시 방문되지 않는다.
   * 의도적인 `nofollow`는 여기 오지 않는다(링크를 따르지 않기로 한 것이라 자식은 미발견으로 센다).
   */
  private async carryChildren(doc: DocRow, ctx: CrawlCtx): Promise<void> {
    if (doc.kind !== 'HTML' || doc.depth >= ctx.source.maxDepth) return;
    const urls = await this.store.findChildDocuments(ctx.source.id, doc.id);
    if (urls.length === 0) return;
    await this.followLinks(doc, ctx, urls, { countOutOfScope: false });
  }

  /** 링크 발견 — 범위 판정 후 프런티어에 배치로 넣는다. 범위 밖 링크는 행을 만들지 않고 개수만 센다(§6.7). */
  private async followLinks(doc: DocRow, ctx: CrawlCtx, rawLinks: readonly string[], opts: { countOutOfScope?: boolean } = {}): Promise<void> {
    const { source, run } = ctx;
    // [항목 7] 링크 깊이 = 부모 depth + 1(하드코딩 1 아님) — 대기열(KbDocument.depth)에 보존한다.
    const childDepth = doc.depth + 1;
    const links = resolveLinks(doc.url, [...rawLinks]);
    // [pass 6 · H-1] 정규화 뒤 같은 URL(`/docs/a`와 `/docs/a#intro`)은 하나로 — 그렇지 않으면 같은 `(소스, urlHash)`가 배치에 둘 들어가 유니크 위반으로 배치 전체를 잃는다.
    const normalizedLinks = [...new Set(links.map((l) => normalizeUrl(l, { allowQueryUrls: source.allowQueryUrls })).filter((n): n is string => !!n))];
    const inScope = normalizedLinks.filter((n) => isInScope(n, childDepth, source));
    const entries: Array<{ url: string; urlHash: string; kind: string; externalFileName: string; depth: number; parentId: string }> = [];
    for (const n of inScope) {
      const kind = detectKind(n, undefined, source.fileTypes);
      if (!kind) continue; // 확장자로 명백한 비대상(이미지·압축·구형 문서 등)은 요청하지 않는다(§6.7) — 범위 밖 링크로 센다.
      entries.push({ url: n, urlHash: computeUrlHash(n), kind, externalFileName: buildExternalFileName(source.id, n, extFromKind(kind)), depth: childDepth, parentId: doc.id });
    }
    if (opts.countOutOfScope !== false) await this.store.addOutOfScopeLinks(run.id, normalizedLinks.length - entries.length);
    if (entries.length === 0) return;
    await this.store.seedFrontier(source.id, run.id, entries, source.maxPages); // [pass 7 · N-3] 행 수 상한 — 상한에 닿으면 새 행을 더 넣지 않는다(carryChildren 포함).
  }

  private async finalizeExcluded(doc: { id: string; missingStreak: number }, reason: KbExcludeReason, observedPiiMasked?: number, observedHash?: string): Promise<void> {
    await this.store.markVisited(doc.id, {
      state: 'EXCLUDED',
      excludeReason: reason,
      missingStreak: doc.missingStreak,
      observedChange: null,
      ...(observedPiiMasked !== undefined ? { observedPiiMasked } : {}),
      ...(observedHash !== undefined ? { observedHash } : {}),
    });
  }

  /**
   * 인증 헤더 — 첫 요청·모든 홉이 같은 규칙(`canSendAuthTo`): 시작 주소·사이트맵에 **명시된 출처(host:port)와 정확히 일치**할 때만 싣는다(자격증명 누출 방지 · §6.9 · RG-26).
   * `startUrl`은 리다이렉트 홉(≥ 1)에서만 준다 — 그 문서의 시작 URL과 같은 host:port여야 한다(RG-24①). 평문 `http:` 요청은 `http:`를 명시한 시작 주소·사이트맵 출처에만 싣는다(pass 13 · RG-28).
   */
  private applyAuthHeader(headers: Record<string, string>, source: SourceConfig, url: string, startUrl?: string): void {
    if (source.authKind !== 'STATIC_HEADER' || !source.authHeaderName || !source.authSecretRef) return;
    if (!canSendAuthTo(source, url, startUrl)) return;
    const secret = this.secretResolver.get(source.authSecretRef);
    if (secret) headers[source.authHeaderName.toLowerCase()] = secret;
  }

  /**
   * robots.txt 규칙 — 호스트(과 스킴)별로 24시간 캐시한다. RFC 9309: 2xx = 파싱 · 4xx(429 제외) = 전부 허용(**이것도 캐시한다** — [pass 6 · M-3] 예전에는 캐시하지 않아 문서마다 robots를 다시
   * 요청했다) · 5xx·429·연결 실패·타임아웃 = 그 호스트 수집 중단(`ABORT_HOST` — 캐시하지 않는다). 리다이렉트는 같은 호스트 안에서 최대 3회 따라간다(범위 밖이면 중단 · [RG-16]).
   * robots.txt 요청도 호스트 페이서를 거친다. 기다리면 조각 예산을 넘으면 `DEFERRED`.
   */
  private async getRobots(pageUrl: string, source: SourceConfig, ctx: CrawlCtx): Promise<RobotsRules | 'ALLOW_ALL' | 'ABORT_HOST' | 'DEFERRED'> {
    // [pass 12 · RG-26] robots.txt는 출처(스킴 + host:port) 단위다(RFC 9309) — 시작 주소에 명시된 포트(`https://a:8443/`)의 robots.txt는 그 포트에서 읽는다(예전에는 기본 포트로 요청해 허용 출처 밖 → 호스트 중단이 된다).
    const scheme = httpOrHttpsScheme(pageUrl);
    const hostPort = urlHostPort(pageUrl);
    const key = robotsKey(scheme, hostPort);
    const cached = this.robotsCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < 24 * 3600 * 1000) return cached.rules;

    const url = `${scheme}//${hostPort}/robots.txt`;
    try {
      const res = await fetchFollowingRedirects(
        this.fetcher,
        { url, allowedHosts: source.allowedHosts, allowedOrigins: source.allowedOrigins, maxBytes: 512 * 1024, timeoutMs: this.timeoutMs(), headersFor: () => ({}) },
        // 같은 호스트 안에서만(스킴 상향 http→https 허용 · 하향·다른 호스트는 중단) — 경로는 어디든 좋다.
        { allowQueryUrls: true, scope: { allowedHosts: [urlHostname(pageUrl)], allowedOrigins: [hostPort], pathPrefixes: [], excludePatterns: [], maxDepth: 0 }, ...this.requestHooks(ctx, { robotsOnHops: false, forRobots: true }) },
      );
      if (res.kind === 'DEFERRED') return 'DEFERRED';
      if (res.kind !== 'RESPONSE') return 'ABORT_HOST';
      const outcome = robotsFetchOutcome(res.status);
      if (outcome === 'ABORT_HOST') return 'ABORT_HOST';
      if (outcome === 'ALLOW_ALL') {
        setBounded(this.robotsCache, key, { rules: 'ALLOW_ALL', fetchedAt: Date.now() }, MAX_ROBOTS_CACHE);
        return 'ALLOW_ALL';
      }
      const rules = parseRobots(decodeBody(res.body, res.contentType ?? null), this.productToken());
      setBounded(this.robotsCache, key, { rules, fetchedAt: Date.now() }, MAX_ROBOTS_CACHE);
      return rules;
    } catch {
      return 'ABORT_HOST';
    }
  }
}

function robotsKey(scheme: 'http:' | 'https:', hostPort: string): string {
  return `${scheme}//${hostPort}`;
}

/** 로그용 경로(쿼리 제외 — 로그 규약 KB-15). */
function urlPath(url: string): string {
  return new URL(url).pathname;
}

/** robots.txt 매칭 대상 — 경로 + 쿼리 문자열(`/a?x=1`). RFC 9309는 쿼리도 규칙과 비교한다(`Disallow: /*?sid=`). */
function pathAndQuery(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

function readStringArray(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** 실행 행 `counts` JSON에 누적한 시작 주소 판정 표식(`seedReached`·`seedFailed`·`seedNeutral`). */
function readSeedState(countsJson: string | undefined): { reached: boolean; failed: boolean; neutral: boolean } {
  const state = { reached: false, failed: false, neutral: false };
  if (!countsJson) return state;
  try {
    const parsed = JSON.parse(countsJson) as { seedReached?: unknown; seedFailed?: unknown; seedNeutral?: unknown };
    state.reached = parsed.seedReached === true;
    state.failed = parsed.seedFailed === true;
    state.neutral = parsed.seedNeutral === true;
  } catch {
    // 형식 오류 — 표식 없음으로 본다.
  }
  return state;
}

/** 종결 도중 실패한 앞선 종결 시도가 저장해 둔 삭제 감지 스윕 몫(RG-20⑤). */
function readSavedSweep(countsJson: string | undefined): { missing: number; gone: number; needsCleanup: number } | null {
  if (!countsJson) return null;
  try {
    const sweep = (JSON.parse(countsJson) as { sweep?: { missing?: unknown; gone?: unknown; needsCleanup?: unknown } }).sweep;
    if (!sweep || typeof sweep.missing !== 'number' || typeof sweep.gone !== 'number' || typeof sweep.needsCleanup !== 'number') return null;
    return { missing: sweep.missing, gone: sweep.gone, needsCleanup: sweep.needsCleanup };
  } catch {
    return null;
  }
}

function readOutOfScopeLinks(countsJson: string | undefined): number {
  if (!countsJson) return 0;
  try {
    const parsed = JSON.parse(countsJson) as { outOfScopeLinks?: unknown };
    return typeof parsed.outOfScopeLinks === 'number' ? parsed.outOfScopeLinks : 0;
  } catch {
    return 0;
  }
}

function extFromKind(kind: string): ExternalFileExt {
  if (kind === 'PDF') return 'pdf';
  if (kind === 'DOCX') return 'docx';
  if (kind === 'XLSX') return 'xlsx';
  if (kind === 'PPTX') return 'pptx';
  return 'html';
}
