import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { KbCrawlRunner } from './kb-crawl.runner';
import { KbIngestRunner } from './kb-ingest.runner';
import { KbSyncJob } from './kb-sync.job';
import { InProcessExtractor } from '../extract/in-process.extractor';
import { WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';

/**
 * [pass 4 · 위반 7] 로그에 오류 원문(`e.message`)이 들어가지 않는다 — 원문에는 URL·쿼리·응답 조각·서버 경로가 섞일 수 있다
 * (KB-15 · AC-KB6-4). 엔진 3곳(크롤 조각·적재 조각·tick 실행 루프)과 부팅 점검에서 던진 오류 원문을 캡처해 확인한다.
 */
const SECRET = 'token=SECRET-VALUE-9f2 https://intra.example/private?api_key=SECRET-VALUE-9f2 D:\\secret\\path\\extract.worker.js';

function config(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function captureLogs() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(push as never));
  return {
    lines,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

function expectNoLeak(lines: string[]): void {
  const all = lines.join('\n');
  expect(all).not.toContain('SECRET-VALUE');
  expect(all).not.toContain('intra.example');
  expect(all).not.toContain('api_key');
  expect(all).not.toContain('secret\\path'); // 오류 원문 속 서버 경로(고정 문구의 파일 이름 자체는 무해하다).
  expect(all).not.toContain('D:\\');
}

describe('엔진 로그에 오류 원문 0 (KB-15)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('적재 조각 예외 — 클래스명 코드만 남기고 false를 돌려준다', async () => {
    const cap = captureLogs();
    const store = { sweepExpiredSubmittingJobs: jest.fn().mockRejectedValue(new Error(SECRET)) } as never;
    const runner = new KbIngestRunner(store, {} as never, {} as never, {} as never, {} as never, {} as never, config({ KB_SYNC_LEASE_MS: 600000 }), new InProcessExtractor(), { tryAcquire: () => true } as never);

    expect(await runner.runFragment(new Date())).toBe(false);

    cap.restore();
    expect(cap.lines.length).toBeGreaterThan(0);
    expect(cap.lines.some((l) => l.includes('code=Error'))).toBe(true);
    expectNoLeak(cap.lines);
  });

  it('크롤 조각 예외 — 실행 id·클래스명 코드만 남긴다', async () => {
    const cap = captureLogs();
    const store = { claimCrawlLease: jest.fn().mockRejectedValue(new TypeError(SECRET)) } as never;
    const runner = new KbCrawlRunner(store, {} as never, {} as never, {} as never, {} as never, config(), new InProcessExtractor());

    await runner.runFragment({ id: 'run-1', sourceId: 'src-1', kind: 'PREVIEW' }, {} as never, Date.now() + 1000, () => false);

    cap.restore();
    expect(cap.lines.some((l) => l.includes('run/run-1') && l.includes('code=TypeError'))).toBe(true);
    expectNoLeak(cap.lines);
  });

  it('tick 실행 루프 예외 — 다음 실행으로 넘어가되 원문은 남기지 않는다', async () => {
    const cap = captureLogs();
    const store = {
      findActiveRunsForCrawl: jest.fn().mockResolvedValue([{ id: 'run-2', sourceId: 'src-2', kind: 'SYNC' }]),
      findSourceById: jest.fn().mockRejectedValue(new RangeError(SECRET)),
    } as never;
    const scheduler = { scheduleDueSources: jest.fn().mockResolvedValue([]) } as never;
    const ingestRunner = { runFragment: jest.fn().mockResolvedValue(false) } as never;
    const job = new KbSyncJob(config({ KB_SYNC_ENABLED: true }), store, scheduler, {} as never, ingestRunner, { now: () => new Date() } as never, new InProcessExtractor());

    await job.tick();

    cap.restore();
    expect(cap.lines.some((l) => l.includes('run/run-2') && l.includes('code=RangeError'))).toBe(true);
    expectNoLeak(cap.lines);
  });

  it('부팅 점검 — 워커 진입점이 없을 때 서버 경로가 든 오류 원문 대신 고정 문구만 남긴다', async () => {
    const cap = captureLogs();
    const extractor: KbExtractorPort = {
      extract: jest.fn(),
      checkAvailability: () => {
        throw new WorkerEntryMissingError(SECRET);
      },
    };
    const store = { ensureLeaseRow: jest.fn().mockResolvedValue(undefined) } as never;
    const job = new KbSyncJob(config({ KB_SYNC_ENABLED: true, KB_INGEST_CONCURRENCY: 1 }), store, {} as never, {} as never, {} as never, { now: () => new Date() } as never, extractor);

    await job.onApplicationBootstrap();

    cap.restore();
    expect(cap.lines.some((l) => l.includes('워커 진입점'))).toBe(true);
    expectNoLeak(cap.lines);
  });
});
