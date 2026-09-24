import { SessionRefResolverService } from './session-ref-resolver.service';

function makePrisma(overrides: { findFirstImpl?: (args: unknown) => unknown } = {}) {
  return {
    handoffSession: {
      findFirst: jest.fn(overrides.findFirstImpl ?? (() => null)),
    },
    conversationLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeSettingsCache() {
  return { get: jest.fn().mockResolvedValue({ activeWindowMinutes: 10 }) };
}

describe('SessionRefResolverService — 코드리뷰 1회차 Medium #5(LRU 5,000건/30분)', () => {
  it('같은 chatbotId·sessionRef 조합은 두 번째 호출부터 DB를 조회하지 않는다(캐시 적중)', async () => {
    let callCount = 0;
    const prisma = makePrisma({
      findFirstImpl: () => {
        callCount += 1;
        return { sessionId: 'session-1' };
      },
    });
    const settingsCache = makeSettingsCache();
    const service = new SessionRefResolverService(prisma as never, settingsCache as never);

    const first = await service.resolve('bot-1', 'ref-1');
    const second = await service.resolve('bot-1', 'ref-1');

    expect(first).toBe('session-1');
    expect(second).toBe('session-1');
    expect(callCount).toBe(1);
  });

  it('TTL이 지나면 다시 DB를 조회한다', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      let callCount = 0;
      const prisma = makePrisma({
        findFirstImpl: () => {
          callCount += 1;
          return { sessionId: 'session-1' };
        },
      });
      const settingsCache = makeSettingsCache();
      const service = new SessionRefResolverService(prisma as never, settingsCache as never);

      await service.resolve('bot-1', 'ref-1');
      jest.setSystemTime(new Date('2026-01-01T00:31:00Z')); // 31분 경과 — TTL(30분) 초과
      await service.resolve('bot-1', 'ref-1');

      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('서로 다른 chatbotId는 독립적으로 캐시된다(키에 chatbotId 포함)', async () => {
    let callCount = 0;
    const prisma = makePrisma({
      findFirstImpl: (args) => {
        callCount += 1;
        const where = (args as { where: { chatbotId: string } }).where;
        return { sessionId: `session-${where.chatbotId}` };
      },
    });
    const settingsCache = makeSettingsCache();
    const service = new SessionRefResolverService(prisma as never, settingsCache as never);

    const a = await service.resolve('bot-A', 'ref-1');
    const b = await service.resolve('bot-B', 'ref-1');

    expect(a).toBe('session-bot-A');
    expect(b).toBe('session-bot-B');
    expect(callCount).toBe(2);
  });

  it('상한(5,000건)을 넘으면 가장 오래된 항목이 축출된다', async () => {
    let callCount = 0;
    const prisma = makePrisma({
      findFirstImpl: (args) => {
        callCount += 1;
        const where = (args as { where: { sessionRef: string } }).where;
        return { sessionId: `session-${where.sessionRef}` };
      },
    });
    const settingsCache = makeSettingsCache();
    const service = new SessionRefResolverService(prisma as never, settingsCache as never);

    await service.resolve('bot-1', 'ref-0'); // 가장 먼저 채워진 항목 — 축출 대상
    for (let i = 1; i <= 5000; i += 1) {
      await service.resolve('bot-1', `ref-${i}`);
    }
    const callsBeforeRecheck = callCount;

    await service.resolve('bot-1', 'ref-0'); // 축출됐으므로 다시 DB를 조회해야 한다
    expect(callCount).toBe(callsBeforeRecheck + 1);
  }, 20_000);
});
