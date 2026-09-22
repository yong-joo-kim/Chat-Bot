import { TrainingJobService } from './training-job.service';

/**
 * `TrainingJobService` — ADR-0027 §4 단위 테스트. ⚠ 구현 시점에 전용 스펙이 없었다(오류검출 갭).
 * 핵심 목적은 `onModuleInit()`의 기동 시 고아 Job 정리(EX-L2-7, SERVER_RESTART)를 검증하는 것 —
 * 단일 인스턴스 전제에서 `QUEUED`|`RUNNING` 상태로 남은 행은 전부 이전 프로세스가 죽으며 남긴
 * 것이므로 기동 즉시 `FAILED`(failureReason: 'SERVER_RESTART')로 전이해야 한다.
 */

function buildService() {
  const prisma = {
    trainingJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
    },
  };
  const service = new TrainingJobService(prisma as never);
  return { service, prisma };
}

describe('TrainingJobService.onModuleInit() — 기동 시 고아 Job 정리(ADR-0027 §4, EX-L2-7)', () => {
  it('QUEUED|RUNNING 상태의 잔존 Job을 FAILED(SERVER_RESTART)로 일괄 전이한다', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.updateMany.mockResolvedValue({ count: 3 });

    await service.onModuleInit();

    expect(prisma.trainingJob.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.trainingJob.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: expect.objectContaining({ status: 'FAILED', failureReason: 'SERVER_RESTART' }),
    });
  });

  it('전이 대상 데이터에 finishedAt(Date)이 채워진다', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.updateMany.mockResolvedValue({ count: 1 });

    await service.onModuleInit();

    const call = prisma.trainingJob.updateMany.mock.calls[0][0];
    expect(call.data.finishedAt).toBeInstanceOf(Date);
  });

  it('고아 Job이 0건이면 조용히 통과한다(예외 없음, count 0)', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('SUCCEEDED|PARTIAL|FAILED로 이미 종료된 Job은 조건절에 포함되지 않는다(where에 종료 상태가 없음을 고정)', async () => {
    const { service, prisma } = buildService();

    await service.onModuleInit();

    const call = prisma.trainingJob.updateMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(['QUEUED', 'RUNNING']);
    expect(call.where.status.in).not.toContain('SUCCEEDED');
    expect(call.where.status.in).not.toContain('FAILED');
    expect(call.where.status.in).not.toContain('PARTIAL');
  });
});

describe('TrainingJobService — CRUD 보조(ADR-0027 §4)', () => {
  it('create()는 chatbotId·kind·targetId로 Job 행을 만든다', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.create.mockResolvedValue({ id: 'job-1' });

    const job = await service.create('c1', 'CLASSIFIER_TRAIN');

    expect(prisma.trainingJob.create).toHaveBeenCalledWith({ data: { chatbotId: 'c1', kind: 'CLASSIFIER_TRAIN', targetId: undefined } });
    expect(job).toEqual({ id: 'job-1' });
  });

  it('findActive()는 QUEUED|RUNNING만 조회 대상으로 삼는다(동시 실행 1건 검사의 근거)', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.findFirst.mockResolvedValue(null);

    await service.findActive('c1', 'AUGMENT', 'intent-1');

    expect(prisma.trainingJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chatbotId: 'c1', kind: 'AUGMENT', targetId: 'intent-1', status: { in: ['QUEUED', 'RUNNING'] } }),
      }),
    );
  });

  it('markFinished(FAILED)는 progress를 100으로 채우고 failureReason을 기록한다', async () => {
    const { service, prisma } = buildService();

    await service.markFinished('job-1', 'FAILED', undefined, 'INSUFFICIENT_DATA');

    expect(prisma.trainingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'FAILED', progress: 100, failureReason: 'INSUFFICIENT_DATA' }),
    });
  });

  it('updateProgress() 실패는 조용히 흡수한다(관측용 부가 정보 — 작업을 막지 않는다)', async () => {
    const { service, prisma } = buildService();
    prisma.trainingJob.update.mockRejectedValueOnce(new Error('db down'));

    await expect(service.updateProgress('job-1', 150)).resolves.toBeUndefined();
    expect(prisma.trainingJob.update).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { progress: 100 } });
  });
});
