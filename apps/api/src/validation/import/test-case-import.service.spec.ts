import { TestCaseImportService } from './test-case-import.service';

/**
 * TC 대량 커밋(commit)의 일괄 insert 회귀 테스트 — code-reviewer 대응(Low, 선택).
 * `for` 루프의 순차 `tx.testCase.create()` 대신 `tx.testCase.createMany()` 1회 호출로
 * 바뀌었는지, 트랜잭션·`tx.` 프리픽스 사용은 그대로인지 확인한다.
 */

function buildTxMock() {
  return {
    testCase: {
      aggregate: jest.fn().mockResolvedValue({ _max: { seq: 3 } }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      create: jest.fn(),
    },
  };
}

function buildPrismaMock(tx: ReturnType<typeof buildTxMock>) {
  return {
    testCase: {
      count: jest.fn().mockResolvedValue(0),
    },
    testCaseSet: {
      findUnique: jest.fn().mockResolvedValue({ id: 'set-1', name: '기본 세트', description: null, isDefault: true }),
    },
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>, stagedPlan: unknown) {
  const scope = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const setService = { getRowOrThrow: jest.fn().mockResolvedValue({ id: 'set-1' }) };
  const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const stagingStore = {
    set: jest.fn(),
    take: jest.fn().mockReturnValue(stagedPlan),
  };
  const csvReader = { read: jest.fn() };
  const xlsxReader = { read: jest.fn() };

  const service = new TestCaseImportService(
    prisma as never,
    scope as never,
    setService as never,
    auditLogService as never,
    stagingStore as never,
    csvReader as never,
    xlsxReader as never,
  );
  return { service, prisma, auditLogService, stagingStore };
}

describe('TestCaseImportService.commit — 대량 insert 방식(code-review 대응, Low)', () => {
  const stagedPlan = {
    chatbotId: 'bot-1',
    resourceType: 'TEST_CASE',
    plan: {
      setId: 'set-1',
      items: [
        { messages: ['안녕'], messagesNormalized: '안녕', expectedKind: 'FALLBACK' },
        { messages: ['반가워'], messagesNormalized: '반가워', expectedKind: 'FALLBACK' },
      ],
      errors: [],
      duplicatedRows: 0,
    },
    expiresAt: new Date(Date.now() + 60_000),
  };

  it('트랜잭션 안에서 tx.testCase.createMany()를 1회 호출하고, 순차 create()는 호출하지 않는다', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    const { service } = buildService(prisma, stagedPlan);

    const result = await service.commit('bot-1', 'set-1', { importToken: 'token-1', mergePolicy: 'MERGE', errorPolicy: 'SKIP_INVALID' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.testCase.createMany).toHaveBeenCalledTimes(1);
    expect(tx.testCase.create).not.toHaveBeenCalled();

    const callArg = tx.testCase.createMany.mock.calls[0][0];
    expect(callArg.data).toHaveLength(2);
    expect(callArg.data[0]).toMatchObject({ setId: 'set-1', chatbotId: 'bot-1', seq: 4, messagesNormalized: '안녕' });
    expect(callArg.data[1]).toMatchObject({ setId: 'set-1', chatbotId: 'bot-1', seq: 5, messagesNormalized: '반가워' });

    expect(result.createdItems).toBe(2);
  });

  it('스테이징된 항목이 0건이면 createMany를 호출하지 않는다', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    const emptyPlan = { ...stagedPlan, plan: { ...stagedPlan.plan, items: [] } };
    const { service } = buildService(prisma, emptyPlan);

    const result = await service.commit('bot-1', 'set-1', { importToken: 'token-1', mergePolicy: 'MERGE', errorPolicy: 'SKIP_INVALID' });

    expect(tx.testCase.createMany).not.toHaveBeenCalled();
    expect(result.createdItems).toBe(0);
  });
});
