import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { KbRunStore } from '../../kb-sync/core/kb-run.store';
import { KbSourcesService } from '../../kb-sync/kb-sources.service';
import { KbCrawlRunner } from '../../kb-sync/engine/kb-crawl.runner';
import { KbScheduler } from '../../kb-sync/engine/kb-scheduler';
import { InProcessExtractor } from '../../kb-sync/extract/in-process.extractor';
import type { KbExtractorPort } from '../../kb-sync/extract/kb-extractor.port';
import type { KbFetchResult } from '../../kb-sync/crawl/kb-crawl-http.fetcher';
import { parseSourceRow } from '../../kb-sync/lib/parse-source-row';
import { KbHostPacer } from '../../kb-sync/crawl/kb-host-pacer';

/**
 * KB 크롤링 잔여 갭(RG-n) 시험용 DB 동반 하네스 — 실제 SQLite(마이그레이션 적용) + 실제 `KbRunStore`·`KbSourcesService`·
 * `KbCrawlRunner`를 쓰고, 네트워크(`fetcher`)·시간(`pacer`)·문서 해석(`extractor`)만 가짜로 바꾼다.
 * 앱 전체를 띄우지 않아 빠르고, 조각 실행(`runFragment`)을 직접 호출하므로 결정론적이다.
 */
const API_ROOT = join(__dirname, '..', '..', '..');

export interface FakeRequest {
  url: string;
  maxBytes: number;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export type FakeRoute = KbFetchResult | ((req: FakeRequest, n: number) => KbFetchResult | Promise<KbFetchResult>);

export function html(body: string, headers: Record<string, string> = {}, status = 200): KbFetchResult {
  return { kind: 'RESPONSE', status, contentType: 'text/html; charset=utf-8', body: Buffer.from(body), headers };
}

/** 200자 이상 본문(NO_BODY 방지) + 링크. */
export function page(title: string, links: string[] = [], filler = '이 문서는 지식베이스 동기화 시험용 본문입니다. '.repeat(12)): string {
  return `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${filler}</p>${links.map((l) => `<a href="${l}">링크</a>`).join('')}</main></body></html>`;
}

export function status(code: number, headers: Record<string, string> = {}): KbFetchResult {
  return { kind: 'RESPONSE', status: code, contentType: 'text/html', body: Buffer.alloc(0), headers };
}

export class FakeFetcher {
  readonly requests: FakeRequest[] = [];
  private readonly routes = new Map<string, FakeRoute>();
  private readonly hits = new Map<string, number>();
  onRequest?: (req: FakeRequest) => void | Promise<void>;

  route(url: string, r: FakeRoute): this {
    this.routes.set(url, r);
    return this;
  }
  hitsOf(url: string): number {
    return this.hits.get(url) ?? 0;
  }
  urls(): string[] {
    return this.requests.map((r) => r.url);
  }
  async fetchOnce(req: { url: string; maxBytes: number; headers?: Record<string, string>; timeoutMs?: number }): Promise<KbFetchResult> {
    const fr: FakeRequest = { url: req.url, maxBytes: req.maxBytes, headers: req.headers ?? {}, timeoutMs: req.timeoutMs };
    this.requests.push(fr);
    const n = (this.hits.get(req.url) ?? 0) + 1;
    this.hits.set(req.url, n);
    if (this.onRequest) await this.onRequest(fr);
    const r = this.routes.get(req.url);
    if (!r) return status(404);
    return typeof r === 'function' ? r(fr, n) : r;
  }
}

/** 항상 준비된 호스트 페이서 — `release()`에 넘어온 간격만 기록한다(시간 대기 없이 재시도 지연 값을 확인). 요청 1건마다 acquire·release가 한 번씩 불린다. */
export class OpenPacer {
  readonly releases: Array<{ host: string; intervalMs: number }> = [];
  acquires = 0;
  now = (): number => Date.now();
  sleep = async (): Promise<void> => undefined;
  isReady(): boolean {
    return true;
  }
  msUntilReady(): number {
    return 0;
  }
  acquire(): void {
    this.acquires += 1;
  }
  release(host: string, _now: number, intervalMs: number): void {
    this.releases.push({ host, intervalMs });
  }
}

/** 실제 `KbHostPacer` + 가짜 시계 — `sleep`이 시계를 앞으로 돌린다(실시간 대기 없이 요청 간격·조각 예산을 결정론적으로 확인). */
export function makeClockedPacer(startMs = 1_000_000): { pacer: KbHostPacer; clock: { t: number }; sleeps: number[] } {
  const clock = { t: startMs };
  const sleeps: number[] = [];
  const pacer = new KbHostPacer();
  pacer.now = () => clock.t;
  pacer.sleep = async (ms: number) => {
    sleeps.push(ms);
    clock.t += ms;
  };
  return { pacer, clock, sleeps };
}

export function makeConfig(values: Record<string, unknown> = {}): ConfigService {
  const merged: Record<string, unknown> = { KB_INGEST_TRANSPORT_ACK: 'INTERNAL_NETWORK', RAG_BASE_URL: 'http://rag.invalid', KB_SYNC_LEASE_MS: 600000, ...values };
  return { get: (key: string) => merged[key] } as unknown as ConfigService;
}

export interface Harness {
  prisma: PrismaService;
  store: KbRunStore;
  sourcesService: KbSourcesService;
  scheduler: KbScheduler;
  config: ConfigService;
  dispose(): Promise<void>;
  makeRunner(opts?: { fetcher?: FakeFetcher; pacer?: unknown; extractor?: KbExtractorPort; config?: ConfigService; secretResolver?: { get(ref: string): string | null } }): { runner: KbCrawlRunner; fetcher: FakeFetcher; pacer: OpenPacer };
  createSource(over?: Record<string, unknown>): Promise<{ id: string; row: Awaited<ReturnType<PrismaService['kbSource']['findUniqueOrThrow']>> }>;
  startRun(sourceId: string, kind?: 'PREVIEW' | 'SYNC' | 'FULL_RESEND'): Promise<string>;
  /** 실행이 CRAWLING·QUEUED를 벗어나거나 조각 상한에 이를 때까지 조각을 돌린다. */
  drive(runner: KbCrawlRunner, runId: string, opts?: { maxFragments?: number; stopping?: () => boolean }): Promise<NonNullable<Awaited<ReturnType<KbRunStore['findRun']>>>>;
  fragment(runner: KbCrawlRunner, runId: string, opts?: { stopping?: () => boolean; deadlineMs?: number; deadlineAt?: number }): Promise<void>;
}

export async function createHarness(label: string, configValues: Record<string, unknown> = {}): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), `chatbot-kb-${label}-`));
  const dbPath = join(tmpDir, 'test.db').replace(/\\/g, '/');
  const url = `file:${dbPath}`;
  process.env.DATABASE_URL = url;
  try {
    execSync('pnpm exec prisma migrate deploy', { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy 실패:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  const store = new KbRunStore(prisma);
  const config = makeConfig(configValues);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const dns = { lookupAll: async () => ['203.0.113.10'] };
  const sourcesService = new KbSourcesService(prisma, config, audit as never, store, dns as never);
  const scheduler = new KbScheduler(store, sourcesService);

  const makeRunner: Harness['makeRunner'] = (opts = {}) => {
    const fetcher = opts.fetcher ?? new FakeFetcher();
    const pacer = (opts.pacer as OpenPacer | undefined) ?? new OpenPacer();
    const runner = new KbCrawlRunner(store, sourcesService, fetcher as never, pacer as never, (opts.secretResolver ?? { get: () => null }) as never, opts.config ?? config, opts.extractor ?? new InProcessExtractor());
    return { runner, fetcher, pacer: pacer as OpenPacer };
  };

  // 소스는 실제 등록 경로(`KbSourcesService.create`)로 만든다 — `kbSource` 쓰기는 그 서비스에만 있어야 한다(KB-9 봉인).
  let seq = 0;
  const createSource: Harness['createSource'] = async (over = {}) => {
    seq += 1;
    const name = `src-${label}-${seq}-${randomUUID().slice(0, 6)}`;
    const dto = {
      name,
      seedUrls: ['https://a.example/docs/'],
      sitemapUrls: [],
      pathPrefixes: ['/docs'],
      excludePatterns: [],
      noisePatterns: [],
      allowQueryUrls: false,
      maxDepth: 3,
      maxPages: 50,
      fileTypes: [],
      maxFileBytes: 20971520,
      minIntervalMs: 500,
      scope: { company: '예시공사', category: '시험', subcategory: name },
      schedule: { kind: 'MANUAL' as const },
      auth: { kind: 'NONE' as const },
      piiMask: true,
      allowRawFileIngest: false,
      rightsConfirmed: true as const,
      ...over,
    };
    const created = await sourcesService.create(dto as never, 'tester');
    await sourcesService.approveConfigVersion(created.id, 1, 'tester'); // 시험에서는 미리보기 승인이 끝난 소스로 시작한다.
    const row = await prisma.kbSource.findUniqueOrThrow({ where: { id: created.id } });
    return { id: row.id, row };
  };

  const startRun: Harness['startRun'] = async (sourceId, kind = 'SYNC') => {
    const src = await prisma.kbSource.findUniqueOrThrow({ where: { id: sourceId } });
    const run = await sourcesService.claimAndCreateRun({ sourceId, sourceName: src.name, kind, trigger: 'MANUAL', configVersion: src.configVersion, nextRunAt: null });
    if (!run) throw new Error('선점 실패');
    return run.id;
  };

  const fragment: Harness['fragment'] = async (runner, runId, opts = {}) => {
    const run = await store.findRun(runId);
    if (!run) throw new Error('실행 없음');
    const srcRow = await prisma.kbSource.findUniqueOrThrow({ where: { id: run.sourceId } });
    await runner.runFragment({ id: run.id, sourceId: run.sourceId, kind: run.kind as 'PREVIEW' | 'SYNC' | 'FULL_RESEND' }, parseSourceRow(srcRow), opts.deadlineAt ?? Date.now() + (opts.deadlineMs ?? 15_000), opts.stopping ?? (() => false));
  };

  const drive: Harness['drive'] = async (runner, runId, opts = {}) => {
    for (let i = 0; i < (opts.maxFragments ?? 40); i += 1) {
      const run = await store.findRun(runId);
      if (run && run.status !== 'QUEUED' && run.status !== 'CRAWLING') return run;
      await fragment(runner, runId, { stopping: opts.stopping });
    }
    return (await store.findRun(runId))!;
  };

  return {
    prisma,
    store,
    sourcesService,
    scheduler,
    config,
    makeRunner,
    createSource,
    startRun,
    drive,
    fragment,
    async dispose() {
      await prisma.$disconnect();
      await new Promise((r) => setTimeout(r, 200));
      try {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Windows 파일 핸들 지연 해제 — 판정에 영향 없음.
      }
    },
  };
}

export const HOST = 'https://a.example';
export const ROBOTS_OK = html('User-agent: *\nAllow: /\n');
