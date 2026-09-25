import { HandoffHintsService } from './handoff-hints.service';

function makeDeps() {
  const prisma = {
    conversationLog: { findFirst: jest.fn().mockResolvedValue({ id: 'log-1', userMessage: '배송 조회', createdAt: new Date('2026-01-01T00:00:00Z') }) },
    handoffMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    cannedResponse: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const scope = { assertReadable: jest.fn().mockResolvedValue(undefined) };
  const resolver = { resolve: jest.fn().mockResolvedValue('session-1') };
  const bundleService = {
    getCached: jest.fn().mockResolvedValue({ bundle: { faqs: [], intents: [], dialogNodes: [] } }),
    build: jest.fn(),
  };
  const semanticMatch = { score: jest.fn() };
  const answerSettingsCache = { get: jest.fn().mockResolvedValue({ semanticEnabled: false }) };
  // [신규 No.40 — §7.1] `scope.assertReadable`이 undefined를 돌려주는 이 스위트는 모드 꺼짐(초안
  // 경로)과 동치다 — `versionBundles`는 호출되지 않는다.
  const versionBundles = { get: jest.fn(), getCore: jest.fn(), warm: jest.fn() };

  const service = new HandoffHintsService(
    prisma as never,
    scope as never,
    resolver as never,
    bundleService as never,
    semanticMatch as never,
    answerSettingsCache as never,
    versionBundles as never,
  );
  return { service, prisma, scope, bundleService, answerSettingsCache, versionBundles };
}

describe('HandoffHintsService — 운영 버전 소스 선택(§7.1, 2026-09-25 per-item 시험 보강)', () => {
  it('모드 켜짐(scope.assertReadable이 prodVersionId를 돌려줌)이면 versionBundles.get()을 운영 버전으로 호출하고 초안 캐시는 쓰지 않는다', async () => {
    const { service, scope, bundleService, versionBundles } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'prod-version-1' });
    versionBundles.get.mockResolvedValue({
      bundle: { faqs: [], intents: [], dialogNodes: [] },
      settings: { semanticEnabled: false },
      semanticSource: undefined,
    });

    await service.getHints('bot-1', 'ref-1');

    expect(versionBundles.get).toHaveBeenCalledWith('bot-1', 'prod-version-1', { topics: 'ACTIVE_ONLY' });
    expect(bundleService.getCached).not.toHaveBeenCalled();
  });

  it('모드 켜짐인데 운영 버전 읽기가 실패하면(ServingVersionUnavailableError) 초안으로 대체하지 않고 답변 후보만 비운다', async () => {
    const { ServingVersionUnavailableError } = jest.requireActual('../environment/serving/version-bundle.service');
    const { service, scope, bundleService, versionBundles } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: 'prod-version-1' });
    versionBundles.get.mockRejectedValue(new ServingVersionUnavailableError('읽기 실패'));

    const result = await service.getHints('bot-1', 'ref-1');

    expect(result.mode).toBe('LEXICAL');
    expect(result.answers).toEqual([]);
    expect(bundleService.getCached).not.toHaveBeenCalled(); // §7.6 — 초안 대체 금지.
  });

  it('모드 꺼짐(prodVersionId 없음)이면 기존처럼 초안 캐시를 쓰고 versionBundles는 호출하지 않는다', async () => {
    const { service, scope, bundleService, versionBundles } = makeDeps();
    scope.assertReadable.mockResolvedValue({ prodVersionId: null });

    await service.getHints('bot-1', 'ref-1');

    expect(bundleService.getCached).toHaveBeenCalledTimes(1);
    expect(versionBundles.get).not.toHaveBeenCalled();
  });
});

describe('HandoffHintsService — 발화당 1회 메모(코드리뷰 1회차 Medium #5, 진짜 LRU + TTL 30분)', () => {
  it('같은 발화(source.key)는 두 번째 호출부터 재계산하지 않는다', async () => {
    const { service, bundleService } = makeDeps();

    await service.getHints('bot-1', 'ref-1');
    await service.getHints('bot-1', 'ref-1');

    expect(bundleService.getCached).toHaveBeenCalledTimes(1);
  });

  it('TTL(30분)이 지나면 다시 계산한다', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      const { service, bundleService } = makeDeps();

      await service.getHints('bot-1', 'ref-1');
      jest.setSystemTime(new Date('2026-01-01T00:31:00Z'));
      await service.getHints('bot-1', 'ref-1');

      expect(bundleService.getCached).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
