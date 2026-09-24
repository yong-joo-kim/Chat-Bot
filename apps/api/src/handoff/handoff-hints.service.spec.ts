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

  const service = new HandoffHintsService(prisma as never, scope as never, resolver as never, bundleService as never, semanticMatch as never, answerSettingsCache as never);
  return { service, prisma, bundleService, answerSettingsCache };
}

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
