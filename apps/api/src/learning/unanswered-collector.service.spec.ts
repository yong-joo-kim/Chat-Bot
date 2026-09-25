import { UnansweredCollectorService } from './unanswered-collector.service';

/**
 * `UnansweredCollectorService` 단위 시험 — 특히 AC-15A-11(PENDING 상한 도달)을 다룬다.
 *
 * ⚠ 이 값은 HTTP 통합 테스트(`stats-learning.integration.spec.ts`)에서 재현할 수 없다:
 * `@nestjs/config`의 `ConfigModule.forRoot()`는 `env.validation.ts`의 `validate()`를 모듈이
 * **import되는 시점**(테스트 파일 상단의 정적 `import { AppModule }`이 평가되는 순간)에 1회
 * 호출해 값을 확정한다(`node_modules/@nestjs/config/dist/config.module.js` 확인). `beforeAll`
 * 안에서 `process.env.UNANSWERED_MAX_PENDING`을 나중에 바꿔도 `ConfigService.get()`은 이미
 * 굳어진 기본값(5000)을 반환한다 — 실제로 5,000개의 HTTP 왕복을 만들 수는 없으므로, 여기서는
 * `ConfigService`를 목(mock)으로 주입해 상한 로직만 결정적으로 검증한다.
 */
describe('UnansweredCollectorService', () => {
  function makeConfig(overrides: Record<string, number> = {}) {
    return { get: (key: string) => overrides[key] } as unknown as import('@nestjs/config').ConfigService;
  }

  function makePrisma(overrides: Partial<Record<string, jest.Mock>> = {}) {
    return {
      unansweredQuestion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        ...overrides,
      },
    } as unknown as import('../prisma/prisma.service').PrismaService;
  }

  const baseInput = {
    chatbotId: 'chatbot-1',
    channelType: 'WEB',
    questionText: '상한테스트질문',
    isAnswered: false,
    blockedByFilter: false,
    inputKind: 'TEXT' as const,
  };

  it('AC-15A-11: PENDING 건수가 상한 미만이면 새 행을 생성한다', async () => {
    const prisma = makePrisma({ count: jest.fn().mockResolvedValue(2) });
    const config = makeConfig({ UNANSWERED_MAX_PENDING: 3 });
    const service = new UnansweredCollectorService(prisma, config);

    await service.collect(baseInput);

    expect(prisma.unansweredQuestion.create).toHaveBeenCalledTimes(1);
  });

  it('AC-15A-11/FR-15-8: PENDING 건수가 상한에 도달하면 새 행 생성을 건너뛴다(경고만, 예외 없음)', async () => {
    const prisma = makePrisma({ count: jest.fn().mockResolvedValue(3) });
    const config = makeConfig({ UNANSWERED_MAX_PENDING: 3 });
    const service = new UnansweredCollectorService(prisma, config);

    await expect(service.collect(baseInput)).resolves.toBeUndefined();

    expect(prisma.unansweredQuestion.create).not.toHaveBeenCalled();
  });

  it('FR-15-8: 상한 도달 상태에서도 기존 행(이미 존재하는 정규화 키)의 재유입 카운트는 계속 증가한다', async () => {
    const existing = { id: 'existing-1', variants: '["상한테스트질문"]', status: 'PENDING' };
    const prisma = makePrisma({
      findUnique: jest.fn().mockResolvedValue(existing),
      count: jest.fn().mockResolvedValue(999), // 이미 상한을 훨씬 넘긴 상태를 가정한다.
    });
    const config = makeConfig({ UNANSWERED_MAX_PENDING: 3 });
    const service = new UnansweredCollectorService(prisma, config);

    await service.collect(baseInput);

    // 병합 경로(mergeIntoExisting)는 상한 검사(createIfUnderLimit) 이전에 분기되므로 항상 update된다.
    expect(prisma.unansweredQuestion.update).toHaveBeenCalledTimes(1);
    expect(prisma.unansweredQuestion.create).not.toHaveBeenCalled();
    const updateArg = (prisma.unansweredQuestion.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.occurredCount).toEqual({ increment: 1 });
  });

  it('설정값 미지정 시 기본 상한(5000)을 사용한다', async () => {
    const prisma = makePrisma({ count: jest.fn().mockResolvedValue(4999) });
    const config = makeConfig({}); // UNANSWERED_MAX_PENDING 미설정 → 기본값 5000
    const service = new UnansweredCollectorService(prisma, config);

    await service.collect(baseInput);

    expect(prisma.unansweredQuestion.create).toHaveBeenCalledTimes(1);
  });

  it('AC-15A-6과 동일한 전제(구조 검증): 수집 실패는 예외를 던지지 않는다(FR-0-37/FR-15-6)', async () => {
    const prisma = makePrisma({ count: jest.fn().mockRejectedValue(new Error('DB down')) });
    const config = makeConfig({ UNANSWERED_MAX_PENDING: 3 });
    const service = new UnansweredCollectorService(prisma, config);

    await expect(service.collect(baseInput)).resolves.toBeUndefined();
  });

  /**
   * [test-automation 추가 — No.44] collectNegativeFeedback() — collect()와 나란한 두 번째 진입점
   * (ADR-0038 §4)의 소스별 상한·재발생 규칙을 mock Prisma로 결정적으로 검증한다. AC-FB4-1/3/4.
   */
  describe('collectNegativeFeedback (No.44 — AC-FB4-1/3/4)', () => {
    const negativeInput = {
      chatbotId: 'chatbot-1',
      channelType: 'WEB',
      questionText: '이 답변이 이상해요',
      isAnswered: true,
      apiNotice: false,
      inputKind: 'TEXT' as const,
      conversationLogId: 'log-1',
    };

    it('AC-FB4-1: 신규 질문이면 source=NEGATIVE_FEEDBACK·lastFeedbackLogId로 QUEUED 생성한다(UNANSWERED 상한과 무관)', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'nq-1' });
      // count()는 실제로는 source 조건에 따라 값이 달라지지만, 여기서는 낮은 값을 반환하게 해
      // '상한 미만'을 재현한다 — 아래에서 실제로 source: 'NEGATIVE_FEEDBACK' 조건으로 조회했는지
      // 별도로 단언해 UNANSWERED 상한과 무관함을 확인한다.
      const prisma = makePrisma({ create, count: jest.fn().mockResolvedValue(5) });
      const config = makeConfig({ FEEDBACK_QUEUE_MAX_PENDING: 2000 });
      const service = new UnansweredCollectorService(prisma, config);

      const result = await service.collectNegativeFeedback(negativeInput);

      expect(result).toEqual({ kind: 'QUEUED', id: 'nq-1' });
      const createArg = (prisma.unansweredQuestion.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.source).toBe('NEGATIVE_FEEDBACK');
      expect(createArg.data.lastFeedbackLogId).toBe('log-1');
      // 상한 조회 자체가 source: NEGATIVE_FEEDBACK로 한정된다(소스별 상한).
      const countArg = (prisma.unansweredQuestion.count as jest.Mock).mock.calls[0][0];
      expect(countArg.where.source).toBe('NEGATIVE_FEEDBACK');
    });

    it('AC-FB4-4: NEGATIVE_FEEDBACK PENDING 상한 도달 시 SKIPPED(LIMIT_REACHED)를 반환하고 create를 호출하지 않는다', async () => {
      const prisma = makePrisma({ count: jest.fn().mockResolvedValue(2000) });
      const config = makeConfig({ FEEDBACK_QUEUE_MAX_PENDING: 2000 });
      const service = new UnansweredCollectorService(prisma, config);

      const result = await service.collectNegativeFeedback(negativeInput);

      expect(result).toEqual({ kind: 'SKIPPED', code: 'LIMIT_REACHED' });
      expect(prisma.unansweredQuestion.create).not.toHaveBeenCalled();
    });

    it('AC-FB4-3: 기존 행이 RESOLVED면 상태를 유지한 채 recurredCount만 증가한다(재발생 신호)', async () => {
      const existing = { id: 'nq-1', variants: '["이 답변이 이상해요"]', status: 'RESOLVED' };
      const update = jest.fn().mockResolvedValue({});
      const prisma = makePrisma({ findUnique: jest.fn().mockResolvedValue(existing), update });
      const config = makeConfig({ FEEDBACK_QUEUE_MAX_PENDING: 2000 });
      const service = new UnansweredCollectorService(prisma, config);

      const result = await service.collectNegativeFeedback(negativeInput);

      expect(result).toEqual({ kind: 'QUEUED', id: 'nq-1' });
      expect(update).toHaveBeenCalledTimes(1);
      const updateArg = update.mock.calls[0][0];
      expect(updateArg.data.recurredCount).toEqual({ increment: 1 });
      expect(updateArg.data.status).toBeUndefined(); // 상태 자동 복귀 없음(FR-15-5 상속)
      expect(prisma.unansweredQuestion.create).not.toHaveBeenCalled();
    });

    it('shouldQueueNegativeFeedback이 제외 판정을 내리면 SKIPPED 사유 코드를 그대로 반환한다(예: API_NOTICE)', async () => {
      const prisma = makePrisma();
      const config = makeConfig({ FEEDBACK_QUEUE_MAX_PENDING: 2000 });
      const service = new UnansweredCollectorService(prisma, config);

      const result = await service.collectNegativeFeedback({ ...negativeInput, apiNotice: true });

      expect(result).toEqual({ kind: 'SKIPPED', code: 'API_NOTICE' });
      expect(prisma.unansweredQuestion.findUnique).not.toHaveBeenCalled();
    });

    it('예상치 못한 오류(DB 다운)는 던지지 않고 FAILED로 흡수한다', async () => {
      const prisma = makePrisma({ findUnique: jest.fn().mockRejectedValue(new Error('DB down')) });
      const config = makeConfig({ FEEDBACK_QUEUE_MAX_PENDING: 2000 });
      const service = new UnansweredCollectorService(prisma, config);

      const result = await service.collectNegativeFeedback(negativeInput);

      expect(result).toEqual({ kind: 'FAILED' });
    });
  });
});
