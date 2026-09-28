import type { ConfigService } from '@nestjs/config';
import { KbSyncJob } from './kb-sync.job';
import { WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractorPort } from '../extract/kb-extractor.port';

/**
 * [R1 리뷰 M-2] `onApplicationBootstrap()`의 워커 엔트리 사전 점검 — 유닛 시험. 실제 앱을 띄우지
 * 않고 생성자 의존성을 전부 손으로 채운 가짜로 대체해 결정론적으로 확인한다.
 */
function makeConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function makeJob(opts: { enabled: boolean; extractor: KbExtractorPort }): KbSyncJob {
  const config = makeConfig({ KB_SYNC_ENABLED: opts.enabled, KB_INGEST_CONCURRENCY: 1 });
  const store = { ensureLeaseRow: jest.fn().mockResolvedValue(undefined) } as never;
  const scheduler = {} as never;
  const crawlRunner = {} as never;
  const ingestRunner = {} as never;
  const clock = { now: () => new Date() } as never;
  return new KbSyncJob(config, store, scheduler, crawlRunner, ingestRunner, clock, opts.extractor);
}

function loopOf(job: KbSyncJob): { start: () => void } {
  return (job as unknown as { loop: { start: () => void } }).loop;
}
function loggerOf(job: KbSyncJob): { error: (m: string) => void } {
  return (job as unknown as { logger: { error: (m: string) => void } }).logger;
}

describe('KbSyncJob.onApplicationBootstrap — M-2 워커 엔트리 사전 점검', () => {
  it('KB_SYNC_ENABLED=false면 checkAvailability를 아예 호출하지 않는다(기능 꺼짐 — 시험 구성에 영향 없음)', async () => {
    const checkAvailability = jest.fn();
    const job = makeJob({ enabled: false, extractor: { extract: jest.fn(), checkAvailability } });
    await job.onApplicationBootstrap();
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it('워커 엔트리가 있으면(정상 통과) 루프를 시작한다', async () => {
    const checkAvailability = jest.fn();
    const job = makeJob({ enabled: true, extractor: { extract: jest.fn(), checkAvailability } });
    const startSpy = jest.spyOn(loopOf(job), 'start');
    await job.onApplicationBootstrap();
    expect(checkAvailability).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('★ 워커 엔트리가 없으면(WorkerEntryMissingError) 루프를 시작하지 않고 명확한 오류를 로그로 남긴다', async () => {
    const checkAvailability = jest.fn(() => {
      throw new WorkerEntryMissingError('시험용: 엔트리 없음');
    });
    const job = makeJob({ enabled: true, extractor: { extract: jest.fn(), checkAvailability } });
    const startSpy = jest.spyOn(loopOf(job), 'start');
    const errorSpy = jest.spyOn(loggerOf(job), 'error').mockImplementation(() => undefined);

    await job.onApplicationBootstrap();

    expect(startSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('워커 진입점'));
  });

  it('checkAvailability가 없는 구현(InProcessExtractor 같은 — 옵셔널)은 항상 통과해 루프를 시작한다', async () => {
    const job = makeJob({ enabled: true, extractor: { extract: jest.fn() } });
    const startSpy = jest.spyOn(loopOf(job), 'start');
    await job.onApplicationBootstrap();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('다른 종류의 예외(WorkerEntryMissingError가 아님)는 그대로 올려보낸다(전역 오류를 숨기지 않는다)', async () => {
    const checkAvailability = jest.fn(() => {
      throw new Error('예상 못 한 버그');
    });
    const job = makeJob({ enabled: true, extractor: { extract: jest.fn(), checkAvailability } });
    await expect(job.onApplicationBootstrap()).rejects.toThrow('예상 못 한 버그');
  });
});
