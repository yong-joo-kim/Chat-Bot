import { TestRunService } from './test-run.service';
import { ApiException } from '../common/api.exception';

function buildPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    testRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 'run-1', pinned: true }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    testRunResult: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    testCase: {
      count: jest.fn().mockResolvedValue(5),
    },
    ...overrides,
  };
}

function buildService(prismaOverrides: Record<string, unknown> = {}, configOverrides: Record<string, number> = {}) {
  const prisma = buildPrismaMock(prismaOverrides);
  const scope = { assertReadable: jest.fn().mockResolvedValue(undefined), assertWritable: jest.fn().mockResolvedValue(undefined) };
  const setService = { getRowOrThrow: jest.fn().mockResolvedValue({ id: 'set-1' }) };
  const queue = { enqueue: jest.fn() };
  const statusSink = {};
  const executor = { execute: jest.fn() };
  const cancelRegistry = { cancel: jest.fn(), isCancelled: jest.fn(), clear: jest.fn() };
  const nameResolver = { resolveNames: jest.fn().mockResolvedValue(new Map()) };
  const config = { get: jest.fn((key: string) => configOverrides[key]) };
  // [신규 No.40 — §12.2] 대상 해석(읽기 전용) — 이 스위트의 시나리오는 target 미지정(초안)이라 호출되지 않는다.
  const environmentRead = { getPointerStatus: jest.fn().mockResolvedValue({ prodVersionId: null, stagingVersionId: null, enabledAt: null, gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 } }) };

  const service = new TestRunService(
    prisma as never,
    scope as never,
    setService as never,
    queue as never,
    statusSink as never,
    executor as never,
    cancelRegistry as never,
    nameResolver as never,
    config as never,
    environmentRead as never,
  );
  return { service, prisma, scope, setService, queue, cancelRegistry, config };
}

describe('TestRunService — 동시 실행 1건·빈 세트·취소·고정 상한(FR-V1-17/22/25, ADR-0029)', () => {
  it('진행 중인 실행이 있으면 409 TEST_RUN_IN_PROGRESS를 던지고 큐에 넣지 않는다', async () => {
    const { service, queue } = buildService({
      testRun: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-run', status: 'RUNNING' }) },
    });

    await expect(service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false })).rejects.toMatchObject({
      getResponse: expect.any(Function),
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('동시 두 요청이 findFirst 사전 검사를 모두 통과해도(TOCTOU), DB 부분 유니크 인덱스 위반(P2002)이 발생한 요청은 409 TEST_RUN_IN_PROGRESS로 변환된다', async () => {
    let callCount = 0;
    const create = jest.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve({ id: 'run-1' });
      return Promise.reject(Object.assign(new Error('Unique constraint failed on the fields: (`chatbotId`)'), { code: 'P2002' }));
    });
    const { service } = buildService({
      testRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create,
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const [r1, r2] = await Promise.allSettled([
      service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false }),
      service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false }),
    ]);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ getResponse: expect.any(Function) });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('create()가 P2002가 아닌 다른 오류로 실패하면 그대로 전파한다(409로 흡수하지 않는다)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('DB 연결 끊김'));
    const { service } = buildService({ testRun: { findFirst: jest.fn().mockResolvedValue(null), create } });

    await expect(service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false })).rejects.toThrow('DB 연결 끊김');
  });

  it('실행 가능한 TC가 0건이면 400 TEST_SET_EMPTY를 던진다', async () => {
    const { service, queue } = buildService({ testCase: { count: jest.fn().mockResolvedValue(0) } });

    await expect(service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false })).rejects.toThrow();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('정상 요청은 QUEUED 상태의 TestRun을 만들고 큐에 태스크를 넣은 뒤 202 페이로드를 반환한다', async () => {
    const { service, queue, prisma } = buildService();

    const result = await service.start('bot-1', 'set-1', { overlaySource: 'NONE', useRag: false });

    expect(result).toEqual({ runId: 'run-1', status: 'QUEUED' });
    expect(prisma.testRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ chatbotId: 'bot-1', setId: 'set-1', mode: 'SINGLE', status: 'QUEUED' }) }),
    );
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue.mock.calls[0][0]).toBe('run-1');
  });

  it('cancel()은 QUEUED|RUNNING 상태에서만 허용되고 취소 레지스트리에 등록한다', async () => {
    const { service, cancelRegistry, prisma } = buildService({
      testRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run-1', status: 'RUNNING' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });

    await service.cancel('bot-1', 'run-1');
    expect(cancelRegistry.cancel).toHaveBeenCalledWith('run-1');
    expect(prisma.testRun.updateMany).toHaveBeenCalledWith({ where: { id: 'run-1', status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', finishedAt: expect.any(Date) } });
  });

  it('이미 종료된 실행은 취소할 수 없다(409 TEST_RUN_CANCELLED)', async () => {
    const { service } = buildService({ testRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED' }) } });
    await expect(service.cancel('bot-1', 'run-1')).rejects.toBeInstanceOf(ApiException);
  });

  it('세트당 고정 상한(기본 5) 도달 시 추가 고정은 거부된다', async () => {
    const { service } = buildService({
      testRun: {
        findFirst: jest.fn().mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', setId: 'set-1', pinned: false }),
        count: jest.fn().mockResolvedValue(5),
      },
    });

    await expect(service.pin('bot-1', 'run-1', { pinned: true })).rejects.toBeInstanceOf(ApiException);
  });
});

describe('TestRunService.listResults — M2 "회귀만" 서버 필터(설계서 §14 후속 조치)', () => {
  function buildWithResults() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const ctx = buildService({
      testRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run-1', chatbotId: 'bot-1' }) },
      testRunResult: { findMany, count },
    });
    return { ...ctx, findMany, count };
  }

  it('regressedOnly=true면 페이지가 아니라 실행 전체에서 A=PASS → B=FAIL만 조회·집계한다', async () => {
    const { service, findMany, count } = buildWithResults();
    await service.listResults('bot-1', 'run-1', { page: 2, pageSize: 50, regressedOnly: true });

    const expectedWhere = { runId: 'run-1', resultA: 'PASS', resultB: 'FAIL' };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere, skip: 50, take: 50 }));
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('regressedOnly=false면 resultB 조건을 붙이지 않는다', async () => {
    const { service, findMany } = buildWithResults();
    await service.listResults('bot-1', 'run-1', { page: 1, pageSize: 50, regressedOnly: false });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { runId: 'run-1' } }));
  });
});
