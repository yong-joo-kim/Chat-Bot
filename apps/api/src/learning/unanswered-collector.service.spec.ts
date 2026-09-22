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
});
