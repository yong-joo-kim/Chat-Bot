import { PollingLoop } from './polling-loop';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const silentLogger = { warn: () => undefined };

describe('PollingLoop(§7.1, §18)', () => {
  it('겹침 없음 — 느린 tick 중에는 다음 tick이 시작되지 않는다', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let calls = 0;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 15,
      logger: silentLogger,
      onTick: async () => {
        calls += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await wait(30);
        concurrent -= 1;
      },
    });

    loop.start();
    await wait(140);
    await loop.stop();

    expect(maxConcurrent).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('예외 후 생존 — onTick 예외를 흡수하고 다음 tick을 계속 예약한다(AC-D2-8)', async () => {
    let calls = 0;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 10,
      logger: silentLogger,
      onTick: async () => {
        calls += 1;
        throw new Error('boom');
      },
    });

    loop.start();
    await wait(60);
    await loop.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('stop()이 진행 중 tick의 완료를 기다린다', async () => {
    let finished = false;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 1000,
      logger: silentLogger,
      onTick: async () => {
        await wait(60);
        finished = true;
      },
    });

    void loop.runOnce(); // tick을 즉시 진행 중 상태로 만든다
    await loop.stop(1000);

    expect(finished).toBe(true);
  });

  it('stop()은 상한 시간을 넘기면 완료를 기다리지 않고 반환한다', async () => {
    let finished = false;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 1000,
      logger: silentLogger,
      onTick: async () => {
        await wait(200);
        finished = true;
      },
    });

    void loop.runOnce();
    const startedAt = Date.now();
    await loop.stop(20);
    const elapsed = Date.now() - startedAt;

    expect(finished).toBe(false);
    expect(elapsed).toBeLessThan(150);
  });

  it('runOnce() 중복 호출은 1회만 실행한다(중복 실행 없음)', async () => {
    let calls = 0;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 1000,
      logger: silentLogger,
      onTick: async () => {
        calls += 1;
        await wait(30);
      },
    });

    const [a, b] = [loop.runOnce(), loop.runOnce()];
    await Promise.all([a, b]);

    expect(calls).toBe(1);
  });

  it('stopping() 신호가 stop() 이후 true를 반환한다', async () => {
    let observed = false;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 1000,
      logger: silentLogger,
      onTick: async (signal) => {
        await wait(30);
        observed = signal.stopping();
      },
    });

    void loop.runOnce();
    await loop.stop(200);

    expect(observed).toBe(true);
  });

  // 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). graceful shutdown(§7.9 —
  // `DeploySchedulesEngine.onModuleDestroy()`가 `loop.stop(30_000)`을 호출) 중 "진행 중 tick 완료를
  // 기다린다"는 기존에 있었지만, "그 이후 새 tick을 시작하지 않는다"는 직접 검증되지 않았다 —
  // start()로 등록된 반복 타이머가 stop() 호출 시점 이후 더 이상 tick을 예약하지 않는지 확인한다.
  it('graceful shutdown — start()로 반복 중이던 타이머는 stop() 이후 새 tick을 시작하지 않는다', async () => {
    let calls = 0;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 15,
      logger: silentLogger,
      onTick: async () => {
        calls += 1;
      },
    });

    loop.start();
    await wait(50); // 최소 1회 이상 tick이 돌 시간을 준다
    expect(calls).toBeGreaterThan(0);

    await loop.stop();
    const callsAtStop = calls;

    // stop() 이후 여러 interval 주기만큼 기다려도 호출 횟수가 늘지 않아야 한다(새 tick 미시작).
    await wait(80);
    expect(calls).toBe(callsAtStop);
  });

  it('graceful shutdown — stop() 진행 중(tick 완료 대기 중)에도 다음 tick을 새로 예약하지 않는다', async () => {
    let calls = 0;
    const loop = new PollingLoop({
      name: 'test',
      intervalMs: 5,
      logger: silentLogger,
      onTick: async () => {
        calls += 1;
        await wait(50); // stop()이 이 tick의 완료를 기다리는 동안 interval(5ms)이 여러 번 지나간다
      },
    });

    loop.start();
    await wait(10); // 첫 tick이 진행 중(러닝 프라미스 존재)이 되도록 기다린다
    await loop.stop(200);

    expect(calls).toBe(1); // stop() 대기 중 interval이 여러 번 지나갔어도 새 tick은 시작되지 않는다
  });
});
