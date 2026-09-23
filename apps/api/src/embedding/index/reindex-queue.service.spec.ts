import { ReindexQueueService } from './reindex-queue.service';
import type { IndexerService } from './indexer.service';
import type { VectorCacheService } from '../vector-cache.service';

/**
 * No.25(챗봇 복원/버전 이력관리) 검증 공백 보강 — `version-history-설계.md` §8.7의
 * "재실행 예약 플래그" 잠재 결함 보완이 실제로 동작하는지 단위 시험한다(2026-09-23 신규).
 * 이전에는 이 서비스의 전용 스펙이 없었다.
 */
describe('ReindexQueueService — §8.7 재실행 예약 플래그', () => {
  function createDeferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('schedule()이 실행 중이 아니면 즉시 색인을 시작한다', async () => {
    const reindexChatbot = jest.fn().mockResolvedValue(undefined);
    const indexer = { reindexChatbot } as unknown as IndexerService;
    const vectorCache = { invalidate: jest.fn() } as unknown as VectorCacheService;
    const service = new ReindexQueueService(indexer, vectorCache);

    service.schedule('chatbot-1');
    expect(reindexChatbot).toHaveBeenCalledTimes(1);
    expect(reindexChatbot).toHaveBeenCalledWith('chatbot-1');

    // 완료까지 대기(microtask flush)
    await Promise.resolve();
    await Promise.resolve();
    expect(service.isRunning('chatbot-1')).toBe(false);
    expect(vectorCache.invalidate).toHaveBeenCalledWith('chatbot-1');
  });

  it('실행 중에 들어온 schedule() 호출은 유실되지 않고 종료 후 정확히 1회 재실행된다', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const calls: number[] = [];
    let callIndex = 0;
    const reindexChatbot = jest.fn().mockImplementation(() => {
      callIndex += 1;
      calls.push(callIndex);
      return callIndex === 1 ? first.promise : second.promise;
    });
    const indexer = { reindexChatbot } as unknown as IndexerService;
    const vectorCache = { invalidate: jest.fn() } as unknown as VectorCacheService;
    const service = new ReindexQueueService(indexer, vectorCache);

    service.schedule('chatbot-1'); // 1회차 시작(아직 완료 안 됨)
    expect(reindexChatbot).toHaveBeenCalledTimes(1);
    expect(service.isRunning('chatbot-1')).toBe(true);

    // 실행 중에 재요청 — 유실되지 않고 예약만 된다(즉시 2회차를 시작하지 않는다).
    service.schedule('chatbot-1');
    service.schedule('chatbot-1'); // 중복 재요청 — Set이므로 여러 번 호출해도 재실행은 1회뿐이어야 한다(무한 루프 없음).
    expect(reindexChatbot).toHaveBeenCalledTimes(1);

    first.resolve(); // 1회차 종료 → finally에서 rerunRequested를 소비해 2회차 자동 시작
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(reindexChatbot).toHaveBeenCalledTimes(2); // 정확히 1회 재실행(3회 이상 아님)
    expect(service.isRunning('chatbot-1')).toBe(true); // 2회차 진행 중

    second.resolve(); // 2회차 종료 — 재요청이 없었으므로 3회차는 없어야 한다(무한 루프 없음의 핵심 단언).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(reindexChatbot).toHaveBeenCalledTimes(2);
    expect(service.isRunning('chatbot-1')).toBe(false);
    expect(vectorCache.invalidate).toHaveBeenCalledTimes(2);
  });

  it('색인 실패(reject)여도 재실행 예약은 정상 소비되고 무한 루프에 빠지지 않는다', async () => {
    const first = createDeferred<void>();
    let callCount = 0;
    const reindexChatbot = jest.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return first.promise.then(() => Promise.reject(new Error('injected')));
      return Promise.resolve();
    });
    const indexer = { reindexChatbot } as unknown as IndexerService;
    const vectorCache = { invalidate: jest.fn() } as unknown as VectorCacheService;
    const service = new ReindexQueueService(indexer, vectorCache);

    service.schedule('chatbot-x');
    service.schedule('chatbot-x'); // 실행 중 재요청

    first.resolve();
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

    expect(reindexChatbot).toHaveBeenCalledTimes(2); // 실패해도 재실행은 여전히 1회 소비된다
    expect(service.isRunning('chatbot-x')).toBe(false);
  });

  it('서로 다른 챗봇의 실행/재예약은 독립적이다', async () => {
    const a = createDeferred<void>();
    const reindexChatbot = jest.fn().mockImplementation((chatbotId: string) => (chatbotId === 'a' ? a.promise : Promise.resolve()));
    const indexer = { reindexChatbot } as unknown as IndexerService;
    const vectorCache = { invalidate: jest.fn() } as unknown as VectorCacheService;
    const service = new ReindexQueueService(indexer, vectorCache);

    service.schedule('a');
    service.schedule('b');
    expect(service.isRunning('a')).toBe(true);
    expect(service.isRunning('b')).toBe(true); // b는 즉시 시작(진행 중일 수 있음)

    service.schedule('a'); // a만 재요청
    a.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(reindexChatbot).toHaveBeenCalledWith('a');
    expect(reindexChatbot).toHaveBeenCalledWith('b');
    // a는 재요청으로 2회, b는 1회여야 한다.
    expect(reindexChatbot.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(2);
    expect(reindexChatbot.mock.calls.filter((c) => c[0] === 'b')).toHaveLength(1);
  });
});
