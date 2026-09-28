import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagHttpClient } from '../../rag/rag-http.client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbRunStore } from '../core/kb-run.store';
import { KbSourcesService } from '../kb-sources.service';
import { KbCrawlHttpFetcher } from '../crawl/kb-crawl-http.fetcher';
import { KbSecretResolver } from '../crawl/kb-secret.resolver';
import { fetchFollowingRedirects } from '../crawl/kb-redirect-follow';
import { HTML_MAX_BYTES } from '../lib/crawl-limits';
import { parseSourceRow } from '../lib/parse-source-row';
import { KB_EXTRACTOR, WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';
import { KB_RAG_CALL_LIMITER } from '../lib/kb-rag-call-limiter';
import type { KbRagCallLimiter } from '../lib/kb-rag-call-limiter';
import { parseIngestResponse } from '../../rag/lib/parse-ingest-response';
import { parseTaskStatus } from '../../rag/lib/parse-task-status';
import { sha256Hex, computeIngestFingerprint } from '../lib/content-fingerprint';
import { decodeBody } from '../lib/charset';
import { buildIngestDocument } from '../lib/ingest-document';
import type { KbHtmlIngestFormat } from '../lib/ingest-document';
import { buildExternalFileName } from '../lib/external-file-name';
import type { ExternalFileExt } from '../lib/external-file-name';
import { computeIngestBackoffMs, isIngestRetryExhausted } from '../lib/backoff';
import { normalizeUrl, urlHostname } from '../lib/url-normalize';
import { canSendAuthTo, type AuthOrigins } from '../lib/allowed-origins';
import { isInScope } from '../lib/scope-match';
import { kbErrorCode, kbLogLine } from '../lib/kb-log-line';
import { isWithinBulkWindow } from '../lib/ingest-lane';
import { parseXRobotsTag } from '../lib/x-robots-tag';
import { inspectRawFile } from '../lib/inspect-raw-file';
import { detectKind, isFileUrl } from '../lib/detect-kind';
import { governanceViolation } from '../lib/governance-flags';

const FILE_MIME: Record<string, string> = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function safeJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stripQueryAndFragment(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** 적재 단계가 읽는 소스 행 — 재수집 범위 재검증(`parseSourceRow`)과 외부 RAG 스코프 3단에 필요한 열. */
type IngestSourceRow = Parameters<typeof parseSourceRow>[0] & { scopeCompany: string; scopeCategory: string; scopeSubcategory: string };

function extFromKind(kind: string): ExternalFileExt {
  if (kind === 'PDF') return 'pdf';
  if (kind === 'DOCX') return 'docx';
  if (kind === 'XLSX') return 'xlsx';
  if (kind === 'PPTX') return 'pptx';
  return 'html';
}

/**
 * ★ 적재 단계(§9.4·§9.5) — `RagHttpClient.ingest()`·`taskStatus()` 호출 파일은 이 파일 1개뿐이다
 * (KB-6). 적재 슬롯 임대는 작업이 **종단 상태가 되거나 백오프로 PENDING에 돌아갈 때까지**(제출 직후가
 * 아니라) 유지된다 — 그래야 동시에 외부에서 진행 중인 작업이 슬롯 수(기본 1)를 넘지 않는다(FR-KB4-5 ·
 * AC-KB4-1). 완료 조회는 슬롯 없이 아무 인스턴스나 할 수 있고(멱등 — 중복 제출 없음), 조회할 때마다 그
 * 작업의 슬롯 임대를 연장한다. 조회 자체가 실패(네트워크·5xx·429)하면 재조회일 뿐 재전송이 아니다 —
 * 재전송은 `not_found` 1회와 제출 단계 실패의 백오프 재시도뿐이다(§5.6).
 */
@Injectable()
export class KbIngestRunner {
  private readonly logger = new Logger('KbIngestRunner');

  constructor(
    private readonly store: KbRunStore,
    private readonly sourcesService: KbSourcesService,
    private readonly prisma: PrismaService,
    private readonly ragClient: RagHttpClient,
    private readonly fetcher: KbCrawlHttpFetcher,
    private readonly secretResolver: KbSecretResolver,
    private readonly config: ConfigService,
    @Inject(KB_EXTRACTOR) private readonly extractor: KbExtractorPort,
    @Inject(KB_RAG_CALL_LIMITER) private readonly rateLimiter: KbRagCallLimiter,
  ) {}

  /**
   * 반환값 = 이번 호출에서 실제로 일(조회·제출)을 했는가 — 호출부가 "더 할 일이 없으면 멈춘다"를
   * 시각(wall-clock) 추정이 아니라 이 값으로 판정한다(§2.3 유휴 tick 예산 · 실측 회귀 방지).
   *
   * [R1 리뷰 H-2] 이 안에서 난 예외(워커 진입점 없음 같은 전역 설정 오류 포함)는 여기서 끝까지
   * 가둔다 — 그러지 않으면 이 tick의 적재 루프(`kb-sync.job.ts`)가 통째로 멈춘다(실행 단위 격리).
   * `false`를 돌려줘 "더 할 일 없음"으로 자연스럽게 이번 tick의 적재 루프를 끝낸다.
   */
  async runFragment(now: Date): Promise<boolean> {
    try {
      // [R2 리뷰 신규 Medium] 슬롯 임대가 만료됐는데도 SUBMITTING에 멈춰 있는 작업(프로세스 크래시 등)
      // 을 되돌린다 — 먼저 해 둬야 이번 조각의 `trySubmitOne()`이 방금 되돌아온 PENDING 작업을 바로
      // 집어갈 수 있다.
      await this.sweepExpiredSubmittingJobs(now);
      const didPoll = await this.pollDue(now);
      const didSubmit = await this.trySubmitOne(now);
      await this.finalizeIngestingRuns(now);
      return didPoll || didSubmit;
    } catch (e) {
      // 오류 원문(`e.message`)에는 URL·경로·응답 조각이 섞일 수 있다 — 고정 형식(클래스명 코드)만 남긴다(KB-15).
      this.logger.error(kbLogLine({ host: '-', path: 'ingest-fragment', code: kbErrorCode(e) }));
      return false;
    }
  }

  private governanceOn(): boolean {
    return this.config.get<string>('DATA_GOVERNANCE_MODE') === 'ON';
  }

  /** `ChatBotKBCrawler/1.0` → `chatbotkbcrawler` — `X-Robots-Tag`의 봇 이름 토큰은 제품 이름만이다(버전 없음). */
  private productToken(): string {
    return (this.config.get<string>('KB_CRAWL_USER_AGENT') ?? 'ChatBotKBCrawler/1.0').split('/')[0].trim().toLowerCase();
  }

  private ack(): string | undefined {
    return this.config.get<string>('KB_INGEST_TRANSPORT_ACK');
  }

  /** [R2 리뷰 신규 Medium] 슬롯 임대 만료 스윕 — 기존 임대 만료 판정 기준(`KB_SYNC_LEASE_MS`)을
   * 그대로 재사용한다(크롤 임대·소스 응답의 `activeRun` 계산과 같은 값). */
  private async sweepExpiredSubmittingJobs(now: Date): Promise<void> {
    const leaseMs = this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600_000;
    await this.store.sweepExpiredSubmittingJobs(leaseMs, now);
  }

  private async vllmReady(now: Date): Promise<boolean> {
    await this.store.ensureLeaseRow('INGEST_STATUS');
    const raw = await this.store.getLeaseState('INGEST_STATUS');
    let state: { checkedAt?: string; vllmReady?: boolean } = {};
    try {
      state = JSON.parse(raw);
    } catch {
      state = {};
    }
    if (state.checkedAt && Math.abs(now.getTime() - new Date(state.checkedAt).getTime()) < 60_000) {
      return state.vllmReady ?? false;
    }
    // [신규 No.43 — 항목④] 인스턴스 버킷 한도 초과 시 이번 tick은 호출하지 않고 캐시값을 그대로 쓴다
    // (checkedAt을 갱신하지 않아 다음 tick에 다시 시도한다).
    if (!this.rateLimiter.tryAcquire(now)) return state.vllmReady ?? false;
    const res = await this.ragClient.status(5000);
    // 판정 기준은 `API_RAG.md` §0-5의 최상위 `vllm_ready === true`다(설계 §5.6 · §5.8). `services.vllm.status`는
    // 보조 정보라 쓰지 않는다 — 예전에 최상위에 없는 `vllm.status`를 읽어 실제 서버에서는 늘 "준비 안 됨"이 됐다.
    let ready = false;
    if (!res.networkError && res.httpStatus >= 200 && res.httpStatus < 300) {
      const body = res.body as { vllm_ready?: unknown } | undefined;
      ready = body?.vllm_ready === true;
    }
    await this.store.setLeaseState('INGEST_STATUS', JSON.stringify({ checkedAt: now.toISOString(), vllmReady: ready }));
    return ready;
  }

  /**
   * [신규 No.43 — 항목⑤] `retryAfterMs`(429·503의 `Retry-After` 해석값)가 있으면 고정 백오프
   * (`computeIngestBackoffMs`)보다 그 값을 우선한다 — 이미 `parseRetryAfterMs`에서 상한(30분)을
   * 적용했으므로 여기서는 그대로 사용한다. 값이 없으면(헤더 부재·비429/503) 기존 고정 백오프로 대체한다.
   */
  private async handleFailureOrRetry(id: string, from: 'SUBMITTING' | 'SUBMITTED', code: string, attemptCount: number, now: Date, retryAfterMs?: number | null): Promise<void> {
    if (code === 'HTTP_400' || code === 'INVALID_TASK_ID') {
      await this.store.failJob(id, from, code, code === 'HTTP_400' ? 400 : undefined, now);
      return;
    }
    if (isIngestRetryExhausted(attemptCount)) {
      await this.store.failJob(id, from, code, undefined, now);
      return;
    }
    const backoffMs = retryAfterMs ?? computeIngestBackoffMs(attemptCount);
    if (backoffMs === null) {
      await this.store.failJob(id, from, code, undefined, now);
      return;
    }
    // 백오프 기준 시각은 tick의 `now`(주입 시계)다 — `Date.now()`를 쓰면 시계를 주입한 시험·다른 판정(`pickNextPendingJob(now)`)과 어긋난다.
    await this.store.retryJob(id, from, new Date(now.getTime() + backoffMs), code);
  }

  private async pollDue(now: Date): Promise<boolean> {
    const pollMs = this.config.get<number>('KB_INGEST_POLL_MS') ?? 10_000;
    const job = await this.store.findDuePolling(pollMs, now);
    if (!job) return false;

    if (job.submittedAt && now.getTime() - job.submittedAt.getTime() > 3 * 3_600_000) {
      await this.store.timeoutJob(job.id, now);
      return true;
    }
    if (!job.taskId) {
      await this.store.markPolled(job.id, now);
      return true;
    }

    // [신규 No.43 — 항목④] 인스턴스 버킷 한도 초과 — 작업 상태를 바꾸지 않고 이번 tick만 건너뛴다
    // (§5.8 — 조회는 다음 tick에 다시 시도, `nextPollAt`을 미루지 않으므로 재시도 손실이 없다).
    if (!this.rateLimiter.tryAcquire(now)) return false;

    const res = await this.ragClient.taskStatus(job.taskId, 10_000);
    const parsed = parseTaskStatus(res);
    if (parsed.outcome === 'PENDING') {
      await this.store.markPolled(job.id, now);
      return true;
    }
    if (parsed.outcome === 'POLL_AGAIN') {
      // 조회가 일시적으로 실패했을 뿐 외부 작업은 진행 중일 수 있다 — 상태를 바꾸지 않고 재조회한다(재전송 아님).
      // 429면 다음 조회를 `KB_INGEST_POLL_MS × 2`(Retry-After가 더 길면 그 값)로 미룬다(§5.8).
      // 무한 재조회는 아니다: 제출 후 3시간이 지나면 위의 TIMEOUT이 끝낸다.
      const nextDelayMs = parsed.rateLimited ? Math.max(pollMs * 2, parsed.retryAfterMs ?? 0) : pollMs;
      await this.store.markPolled(job.id, new Date(now.getTime() + nextDelayMs - pollMs), now);
      return true;
    }
    if (parsed.outcome === 'SUCCEEDED') {
      await this.store.succeedJob(job.id, 'SUBMITTED', now);
      return true;
    }
    if (parsed.outcome === 'NOT_FOUND') {
      // 외부 RAG가 재시작돼 작업 기록이 사라졌다 — 실패가 아니라 결과 불명이다. 같은 파일 이름으로 1회만
      // 다시 보내고(덮어쓰기), 재전송 뒤에도 `not_found`이면 `TASK_LOST`로 끝낸다.
      const resubmitted = await this.store.resubmitNotFound(job.id, now);
      if (!resubmitted) await this.store.failJob(job.id, 'SUBMITTED', 'TASK_LOST', undefined, now);
      return true;
    }
    await this.handleFailureOrRetry(job.id, 'SUBMITTED', parsed.resultCode, job.attemptCount, now, parsed.retryAfterMs);
    return true;
  }

  private async trySubmitOne(now: Date): Promise<boolean> {
    if (!this.ack()) return false;
    if (!this.ragClient.isConfigured()) return false;

    // BULK 레인은 `KB_INGEST_BULK_WINDOW` 시간창 안에서만 고른다(§9.4 · §9.7 — 업무 시간 챗봇 답변 보호).
    const bulkAllowed = isWithinBulkWindow(this.config.get<string>('KB_INGEST_BULK_WINDOW') ?? '', now);

    // 클레임 슬롯을 잡기 전에 먼저 "할 일이 있는가"부터 값싸게(읽기 전용) 확인한다 — 유휴 tick이
    // 슬롯 임대 행을 매번 잡았다 놓는 것을 막는다(§2.3 유휴 tick 예산).
    const pending = await this.store.pickNextPendingJob(now, bulkAllowed);
    if (!pending) return false;
    // [pass 6 · RG-19] 외부 RAG 준비 확인(상태 조회 호출)보다 먼저 실행 상태를 본다 — 중지된 실행의 고아 작업은 외부 호출 0으로 정리한다.
    const runGate = await this.runGate(pending.id, pending.runId);
    if (runGate === 'CANCELLED') return true;
    if (runGate === 'WAIT') return false;
    // [pass 8 · PM 결정 2026-09-28] 거버넌스 규칙에 걸리는 소스의 작업은 외부 RAG 상태 조회보다도 먼저 — 외부 호출 0으로 — 실행을 끝낸다.
    if (await this.terminateIfGovernanceBlocked(pending.sourceId, pending.runId, now)) return true;
    if (!(await this.vllmReady(now))) return false;

    const concurrency = this.config.get<number>('KB_INGEST_CONCURRENCY') ?? 1;
    const slotNames = Array.from({ length: concurrency }, (_, i) => `INGEST_SLOT_${i}`);
    for (const name of slotNames) await this.store.ensureLeaseRow(name);
    const leaseMs = this.config.get<number>('KB_SYNC_LEASE_MS') ?? 600_000;
    // 이미 외부에서 진행 중인 작업이 슬롯을 쥐고 있으면(제출 뒤에도 유지된다) 여기서 null — 이번 tick은 대기.
    const slotKey = await this.store.claimAnySlot(slotNames, leaseMs, now, 'ingest');
    if (!slotKey) return false;

    // 슬롯은 "제출해서 SUBMITTED가 된 작업"이 쥐고 넘어갈 때만 유지한다. 그 밖의 모든 경우(대기·건너뜀·
    // 백오프·예외)는 여기서 놓는다 — 작업 전이 메서드가 이미 놓았다면 CAS라 무해하다.
    let keepSlot = false;
    try {
      // 슬롯을 얻는 사이 다른 인스턴스가 먼저 가져갔을 수 있어 다시 조회한다.
      const job = await this.store.pickNextPendingJob(now, bulkAllowed);
      if (!job) return false;
      const [source, run] = await Promise.all([this.prisma.kbSource.findUnique({ where: { id: job.sourceId } }), this.store.findRun(job.runId)]);
      // 슬롯을 얻는 사이 실행이 중지·종결됐을 수 있어 한 번 더 본다(위의 사전 확인과 같은 판정).
      const gate = run ? await this.runGate(job.id, job.runId, run.status) : 'GO';
      if (gate === 'CANCELLED') return true;
      if (gate === 'WAIT') return false;
      if (!source || !source.enabled || !run || run.configVersion !== source.configVersion) {
        await this.store.cancelJobConfigChanged(job.id);
        return true;
      }
      // 슬롯을 얻는 사이 저장된 값이 바뀌었을 수 있어 방금 읽은 소스 행으로 한 번 더 본다(위의 사전 확인과 같은 판정 · 추가 조회 없음).
      if (await this.terminateIfGovernanceBlocked(job.sourceId, job.runId, now, source)) return true;

      // [신규 No.43 — 항목④] 인스턴스 버킷 한도 초과 — 제출 자체를 시도하지 않는다(§5.8). `attemptCount`를
      // 건드리기 전(= `claimJobForSubmission` 이전)에 확인해 로컬 한도가 재시도 소진에 영향을 주지 않게 한다.
      if (!this.rateLimiter.tryAcquire(now)) return false;

      const claimed = await this.store.claimJobForSubmission(job.id, slotKey);
      if (!claimed) return true;
      keepSlot = await this.submitJob(job.id, source, slotKey, now);
      return true;
    } finally {
      if (!keepSlot) await this.store.releaseSlot(slotKey);
    }
  }

  /**
   * [pass 8 · PM 결정 2026-09-28] 거버넌스 ON인데 소스의 **저장된** 값이 규칙에 걸리면(마스킹 끔 · 서버 허용 없는 원본 파일 전달 — 모드를 켜기 전에 저장된 소스) 원문이 외부 RAG로 나가기 전에 이 실행을
   * 끝낸다. 종결은 기존 중지 경로(`cancelRunAndRelease` — 실행 상태 · 대기 작업 취소 · 슬롯 해제 · 문서 `activeIngestJobId` 정리 · 소스 선점 해제가 한 트랜잭션)를 쓰고, 이미 적재된 문서 행·외부 파일 이름은
   * 건드리지 않는다. 실행 이력에는 사유(`GOVERNANCE_*` 실패 코드)가 남는다. 그 사이 다른 인스턴스가 먼저 끝냈어도(`cancelRunAndRelease`가 `false`) 남은 작업은 다음 조각의 `runGate`가 정리하므로 이번 조각은 `true`로 마친다.
   * 거버넌스 판정은 저장 시점 검증과 같은 순수 함수·같은 설정 키(`DATA_GOVERNANCE_MODE`·`KB_ALLOW_RAW_FILE_INGEST`)를 쓴다.
   */
  private async terminateIfGovernanceBlocked(sourceId: string, runId: string, now: Date, knownSource?: { piiMask: boolean; allowRawFileIngest: boolean } | null): Promise<boolean> {
    if (!this.governanceOn()) return false; // OFF에서는 소스를 더 읽지 않는다(기존 동작 그대로).
    const source = knownSource ?? (await this.prisma.kbSource.findUnique({ where: { id: sourceId }, select: { piiMask: true, allowRawFileIngest: true } }));
    if (!source) return false; // 소스가 없으면 뒤의 설정 변경 판정이 작업을 취소한다.
    const violation = governanceViolation({ governanceOn: true, rawFileAllowedByServer: this.config.get<boolean>('KB_ALLOW_RAW_FILE_INGEST') ?? false }, source);
    if (!violation) return false;
    // [pass 10 · U-3] 종결과 감사 `[적재 차단]` 기록은 소스 서비스가 맡는다 — CAS 승자만 감사 1건(중복 없음).
    const cancelled = await this.sourcesService.terminateRunForGovernance(sourceId, runId, now, violation);
    if (cancelled) this.logger.warn(kbLogLine({ host: '-', path: `run/${runId}`, code: violation }));
    return true;
  }

  /**
   * [pass 6 · RG-19] 이 작업의 실행 상태로 제출 가능 여부를 정한다 — `INGESTING`이면 `GO`, 이미 종단(중지·실패·완료)이면 작업을 CANCELLED로 정리하고(`CANCELLED`) 제출하지 않으며,
   * 아직 크롤 종결 중(QUEUED·CRAWLING — 작업은 만들어졌지만 실행이 INGESTING으로 넘어가기 직전)이면 취소하지도 제출하지도 않고 `WAIT`(잠시 뒤 다시 본다).
   * 종결 직전 중지 경합으로 CANCELLED 실행에 남은 PENDING 작업이 중지 뒤에도 외부로 제출되던 결함(AC-KB5-4)을 막는다.
   */
  private async runGate(jobId: string, runId: string, knownStatus?: string): Promise<'GO' | 'CANCELLED' | 'WAIT'> {
    const status = knownStatus ?? (await this.store.findRun(runId))?.status;
    if (status === undefined) return 'GO'; // 실행 행이 없으면 아래 소스·설정 판정이 취소한다.
    if (status === 'INGESTING') return 'GO';
    if (status === 'QUEUED' || status === 'CRAWLING') return 'WAIT';
    await this.store.cancelJobRunTerminated(jobId);
    return 'CANCELLED';
  }

  /** 인증 헤더 — 크롤과 같은 규칙(`canSendAuthTo`): 허용 출처(host:port — 시작 주소·사이트맵에서 계산)와 정확히 일치할 때만, 홉(≥ 1)은 시작 URL과 같은 host:port여야 한다(pass 10 · RG-24① · pass 12 · RG-26). 평문 `http:` 요청은 `http:`를 명시한 출처에만(pass 13 · RG-28). */
  private applyAuth(headers: Record<string, string>, source: { authKind: string; authHeaderName: string | null; authSecretRef: string | null }, origins: AuthOrigins, url: string, startUrl?: string): void {
    if (source.authKind !== 'STATIC_HEADER' || !source.authHeaderName || !source.authSecretRef) return;
    if (!canSendAuthTo(origins, url, startUrl)) return;
    const secret = this.secretResolver.get(source.authSecretRef);
    if (secret) headers[source.authHeaderName.toLowerCase()] = secret;
  }

  private async submitJob(
    jobId: string,
    source: IngestSourceRow,
    slotKey: string,
    now: Date,
  ): Promise<boolean> {
    const job = await this.store.findJob(jobId);
    if (!job) return false;
    const doc = await this.prisma.kbDocument.findUnique({ where: { id: job.documentId } });
    if (!doc) {
      await this.store.markSkipped(jobId, 'GONE_AT_INGEST');
      return false;
    }

    // [pass 9 · M-3] 적재 단계 방어 — 이 문서의 URL이 **현재** 소스 범위(허용 호스트·경로 접두·제외 패턴·쿼리 허용)에 들어가는지 다시 본다(설계 §9.5 2단계 — 범위 밖 = `SKIPPED(EXCLUDED_AT_INGEST)`).
    // 소스 설정이 줄어든(경로 접두 축소·제외 패턴 추가) 뒤에도 옛 작업·문서 행이 남아 범위 밖 페이지를 외부 RAG로 다시 보내지 않게 한다. 깊이는 크롤 개념이라 0으로 본다(리다이렉트 홉 검증과 같다).
    const scopeConfig = parseSourceRow(source);
    const normalizedDocUrl = normalizeUrl(doc.url, { allowQueryUrls: scopeConfig.allowQueryUrls });
    if (!normalizedDocUrl || !isInScope(normalizedDocUrl, 0, scopeConfig)) {
      await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
      return false;
    }

    // [pass 6 · H-3] FULL_RESEND는 문서 해시·지문이 같아도 무시하고 다시 보낸다(설계 §9.8 — "해시 무시") — 같으면 건너뛰는 규칙은 NEW·CHANGED 작업에만 적용한다.
    const forceResend = job.reason === 'FULL_RESEND';
    const sourceConfig = scopeConfig;
    const allowedHosts = sourceConfig.allowedHosts;
    const headers: Record<string, string> = {};
    this.applyAuth(headers, source, sourceConfig, doc.url);
    // [pass 10 · RG-24③] 타임아웃은 홉 URL마다 정한다 — 크롤과 같은 규칙(그 홉의 URL이 문서 파일이면 ×4). 예전에는 `doc.kind` 기준 1값이라 HTML이 파일로(또는 반대로) 리다이렉트되면 그 홉에 맞지 않았다.
    const baseTimeoutMs = this.config.get<number>('KB_CRAWL_TIMEOUT_MS') ?? 15_000;
    const timeoutMs = (url: string): number => baseTimeoutMs * (isFileUrl(url) ? 4 : 1);
    // [pass 6 · RG-20⑥] HTML 재수집 응답 상한은 크롤 단계와 같은 2MB(파일은 소스 상한).
    const maxBytes = doc.kind === 'HTML' ? Math.min(source.maxFileBytes, HTML_MAX_BYTES) : source.maxFileBytes;

    // [pass 6 · Low-3] 재수집(최대 60초 × 홉) · 해석(30초) · 외부 전송(120초)이 이어지는 구간이 슬롯 임대 최소값보다 길 수 있어, 각 구간 앞에서 슬롯 임대를 갱신한다.
    await this.renewSlotLease(slotKey, now);
    // [pass 6 · RG-16] 재수집도 크롤러와 같은 리다이렉트 추종을 쓴다(홉마다 범위 재검증) — 리다이렉트되는 문서(/docs → /docs/)가 영원히 적재 실패하던 결함.
    const fetchRes = await fetchFollowingRedirects(
      this.fetcher,
      {
        url: doc.url,
        allowedHosts,
        allowedOrigins: sourceConfig.allowedOrigins,
        maxBytes,
        timeoutMs,
        headersFor: (url, hop) => {
          if (hop === 0) return headers;
          const hopHeaders: Record<string, string> = {};
          // [pass 10 · RG-24① · pass 12 · RG-26] 허용 출처와 정확히 일치하고 시작 URL과 같은 host:port일 때만 인증 헤더를 싣는다(크롤과 같은 규칙).
          this.applyAuth(hopHeaders, source, sourceConfig, url, doc.url);
          return hopHeaders;
        },
      },
      {
        allowQueryUrls: sourceConfig.allowQueryUrls,
        scope: sourceConfig,
        // [pass 7 · N-10] 리다이렉트 홉 사이에도 슬롯 임대를 갱신한다 — 홉 × 요청 타임아웃(파일 ×4)이 임대 최소값보다 길어질 수 있다(첫 요청 전에는 위에서 이미 갱신했다).
        beforeRequest: async (_url, hop) => {
          if (hop > 0) await this.renewSlotLease(slotKey, now);
          return null;
        },
      },
    );
    // 범위 밖·하향·홉 초과·순환 리다이렉트, 응답 상한 초과는 다시 받아도 같다 — 재시도하지 않고 적재 대상에서 뺀다.
    if (fetchRes.kind === 'REDIRECT_OUT_OF_SCOPE' || (fetchRes.kind === 'ERROR' && fetchRes.outcome === 'RESPONSE_TOO_LARGE')) {
      await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
      return false;
    }

    // 재수집 실패(사이트 오류·네트워크)도 제출 실패와 같은 백오프(1·5·30분)·소진 규칙을 쓴다 — 예전엔 고정 1분
    // 재시도를 횟수 제한 없이 반복해, 사이트가 계속 죽어 있으면 작업이 PENDING에서 영원히 못 벗어났다(§9.5).
    if (fetchRes.kind !== 'RESPONSE') {
      await this.handleFailureOrRetry(jobId, 'SUBMITTING', 'NETWORK_ERROR', job.attemptCount, now);
      return false;
    }
    if (fetchRes.status === 404 || fetchRes.status === 410) {
      await this.store.markSkipped(jobId, 'GONE_AT_INGEST');
      return false;
    }
    if (fetchRes.status < 200 || fetchRes.status >= 300) {
      await this.handleFailureOrRetry(jobId, 'SUBMITTING', 'UPSTREAM_ERROR', job.attemptCount, now);
      return false;
    }
    // [pass 7 · N-6] 재수집이 리다이렉트를 따라 다른 종류(HTML ↔ 문서 파일)에 닿았다면 이 문서(행)의 종류로 잘못 해석해 보내지 않는다 — 예전에는 PDF 바이트를 HTML로 읽어 보낼 수 있었다.
    // 종류가 바뀐 URL은 다음 크롤이 리다이렉트 원본(방문 표시만)과 목적지 행으로 나눠 기록한다(§6.4).
    if (detectKind(fetchRes.finalUrl, undefined, sourceConfig.fileTypes) !== doc.kind) {
      await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
      return false;
    }

    let bytes: Uint8Array;
    let contentType: string;
    let ext: ExternalFileExt;
    let contentHash: string;
    let ingestFingerprint: string;
    let textLength: number;
    let piiMaskedCount = 0;

    if (doc.kind === 'HTML') {
      const decoded = decodeBody(fetchRes.body, fetchRes.contentType ?? null);
      const format = (this.config.get<string>('KB_HTML_INGEST_FORMAT') ?? 'DOCX') as KbHtmlIngestFormat;
      // [R1 리뷰 H-2] 추출(타임아웃·작업 스레드 크래시)은 이 작업 하나의 실패로 가둔다 — 예외를
      // 그대로 흘려보내면 이미 `SUBMITTING`으로 전이된 이 작업이 그 상태에 영원히 갇히고(재시도도
      // 안 됨), 같은 tick의 다른 소스 작업까지 멈춘다. 설계서 상태 기계상 "이 문서는 적재 대상에서
      // 빠진다"는 이미 있는 `EXCLUDED_AT_INGEST`(§9.5 — `allowRawFileIngest` 꺼짐과 같은 결)로
      // 처리한다 — 재시도해도 다시 실패할 내용 문제이므로 SKIPPED가 맞다. 워커 진입점 자체가 없는
      // 전역 설정 오류는 이 작업의 탓으로 위장하지 않고 그대로 올려보낸다(호출부에서 실행 단위로
      // 격리한다).
      let extracted: Awaited<ReturnType<KbExtractorPort['extract']>>;
      try {
        extracted = await this.extractor.extract({ kind: 'HTML', html: decoded, noisePatterns: safeJsonArray(source.noisePatterns), piiMask: source.piiMask, piiMaskMode: 'PARTIAL' });
      } catch (e) {
        if (e instanceof WorkerEntryMissingError) {
          // [R2 리뷰 신규 Medium] 전역 설정 오류를 올려보내기 전에 `claimJobForSubmission`이 이미
          // SUBMITTING으로 바꿔 둔 이 작업을 되돌린다 — 그러지 않으면 이 작업이 SUBMITTING에 영구히
          // 남아 실행이 INGESTING을 벗어나지 못한다. 추출 실패는 외부 RAG 호출(`ragClient.ingest()`)
          // 이전 단계라 전송 자체가 없었던 것이 확실하므로 백오프 없이 즉시 PENDING으로, `attemptCount`
          // 는 소모하지 않는다(`claimJobForSubmission`의 increment를 상쇄).
          await this.store.revertSubmissionClaim(jobId, 'SUBMITTING');
          throw e;
        }
        await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
        return false;
      }
      // [pass 5 · RG-12] 크롤 뒤 페이지가 `noindex`로 바뀌었을 수 있다(메타 `robots` · `X-Robots-Tag` 헤더) — 외부로 보내지 않는다(§9.5 2단계).
      if (extracted.noindex || parseXRobotsTag(fetchRes.headers['x-robots-tag'], this.productToken()).noindex) {
        await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
        return false;
      }
      contentHash = sha256Hex(extracted.normalizedText);
      ingestFingerprint = computeIngestFingerprint({ contentHash, format, piiMask: source.piiMask, piiMaskMode: 'PARTIAL' });
      if (!forceResend && doc.contentHash === contentHash && doc.ingestFingerprint === ingestFingerprint) {
        await this.store.markSkipped(jobId, 'UNCHANGED_AT_INGEST');
        return false;
      }
      const built = buildIngestDocument({
        format,
        sourceUrl: stripQueryAndFragment(doc.url),
        title: extracted.title ?? null,
        collectedAtIso: now.toISOString(),
        maskedBodyText: extracted.text,
      });
      bytes = built.bytes;
      contentType = built.contentType;
      ext = built.ext;
      textLength = extracted.normalizedText.length;
      piiMaskedCount = extracted.piiMaskedCount;
    } else {
      if (!source.allowRawFileIngest) {
        await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
        return false;
      }
      contentHash = sha256Hex(fetchRes.body);
      ingestFingerprint = contentHash;
      if (!forceResend && doc.contentHash === contentHash) {
        await this.store.markSkipped(jobId, 'UNCHANGED_AT_INGEST');
        return false;
      }
      // [pass 5 · RG-8] 내용이 크롤 뒤 바뀌었을 수 있어 재수집한 바이트도 같은 사전 검사(컨테이너 가드·매크로·암호·개인정보 건수)를 거친다 —
      // 통과하지 못하면 외부로 보내지 않는다. 워커 진입점 부재(전역 설정 오류)는 선점을 되돌리고 올려 보낸다(HTML 추출과 같은 처리).
      let inspection: Awaited<ReturnType<typeof inspectRawFile>>;
      try {
        inspection = await inspectRawFile(this.extractor, doc.kind, fetchRes.body, { governanceOn: this.governanceOn() });
      } catch (e) {
        if (e instanceof WorkerEntryMissingError) await this.store.revertSubmissionClaim(jobId, 'SUBMITTING');
        throw e;
      }
      if (!inspection.ok || (this.governanceOn() && inspection.piiMaskedCount > 0)) {
        await this.store.markSkipped(jobId, 'EXCLUDED_AT_INGEST');
        return false;
      }
      piiMaskedCount = inspection.piiMaskedCount;
      bytes = fetchRes.body;
      contentType = FILE_MIME[doc.kind] ?? 'application/octet-stream';
      ext = extFromKind(doc.kind);
      textLength = 0;
    }

    const externalFileName = buildExternalFileName(source.id, doc.url, ext);
    await this.renewSlotLease(slotKey, now); // 재수집·해석이 끝났다 — 외부 전송(최대 120초) 전에 다시 갱신한다.
    await this.store.recordSubmissionMeta(jobId, { externalFileName, contentHash, ingestFingerprint, textLength, byteSize: bytes.length, fileKind: doc.kind, piiMaskedCount });

    const ingestRes = await this.ragClient.ingest({
      file: { name: externalFileName, bytes, contentType },
      company: source.scopeCompany,
      category: source.scopeCategory,
      subcategory: source.scopeSubcategory,
    });
    const parsed = parseIngestResponse(ingestRes);
    this.logger.log(kbLogLine({ host: urlHostname(doc.url), path: new URL(doc.url).pathname, code: `INGEST_${parsed.outcome}` }));

    if (parsed.outcome === 'ACCEPTED') {
      // SUBMITTED가 된 작업이 슬롯을 계속 쥔다 — 완료(성공·실패·타임아웃)까지 이 슬롯으로는 새 제출이 없다.
      return this.store.markSubmitted(jobId, slotKey, parsed.taskId, now);
    }
    if (parsed.outcome === 'SUCCEEDED') {
      await this.store.succeedJob(jobId, 'SUBMITTING', now);
      return false;
    }
    await this.handleFailureOrRetry(jobId, 'SUBMITTING', parsed.resultCode, job.attemptCount, now, parsed.retryAfterMs);
    return false;
  }

  /** 슬롯 임대 갱신 — 토큰이 다르면(다른 인스턴스가 이어받음) 아무 일도 없다(CAS). 기준 시각은 tick 시각과 실시각 중 늦은 쪽(주입 시계가 과거여도 임대가 실제보다 일찍 만료되지 않게). */
  private async renewSlotLease(slotKey: string, now: Date): Promise<void> {
    await this.store.renewSlot(slotKey, new Date(Math.max(now.getTime(), Date.now())));
  }

  private async finalizeIngestingRuns(now: Date): Promise<void> {
    const runs = await this.store.findIngestingRuns(20);
    for (const run of runs) {
      const counts = await this.store.countJobsByRun(run.id);
      const inFlight = (counts.PENDING ?? 0) + (counts.SUBMITTING ?? 0) + (counts.SUBMITTED ?? 0);
      if (inFlight > 0) continue;
      const hasFailure = (counts.FAILED ?? 0) + (counts.UNKNOWN ?? 0) + (counts.TIMEOUT ?? 0) > 0;
      // 종결과 소스 선점 해제는 한 트랜잭션이다(중간에 죽어도 소스가 "실행 중"으로 남지 않는다 — RG-5).
      await this.sourcesService.finishIngestingAndRelease(run.sourceId, run.id, hasFailure ? 'PARTIAL' : 'SUCCEEDED', now);
    }
  }
}
