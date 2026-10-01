import { AugmentationCircuit, CircuitTransition, classifyCircuitFailure } from './augmentation-circuit';

/** K-1c — 회로 상태표 전 행(설계 §5.3). 가짜 시계로 시간을 제어한다(실시간 대기 없음). */
function make(over: Partial<ConstructorParameters<typeof AugmentationCircuit>[0]> = {}) {
  const clock = { t: 1_000 };
  const events: CircuitTransition[] = [];
  const circuit = new AugmentationCircuit({
    threshold: 3,
    openMs: 60_000,
    now: () => clock.t,
    onTransition: (e) => events.push(e),
    ...over,
  });
  const fail = (): void => {
    const p = circuit.tryAcquire();
    expect(p).not.toBeNull();
    circuit.record(p!, 'infra');
  };
  return { clock, events, circuit, fail };
}

describe('AugmentationCircuit(K-1c)', () => {
  it('닫힘 — 임계 미만의 인프라 실패는 통과를 막지 않는다', () => {
    const t = make();
    t.fail();
    t.fail();
    expect(t.circuit.isOpen()).toBe(false);
    expect(t.circuit.tryAcquire()).not.toBeNull();
    expect(t.events).toEqual([]);
  });

  it('임계 연속 인프라 실패 → 개방 · 개방 중 tryAcquire 거부 · 전이 이벤트 1회', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    expect(t.circuit.isOpen()).toBe(true);
    expect(t.circuit.tryAcquire()).toBeNull();
    expect(t.events).toEqual(['OPENED']);
  });

  it('성공은 연속 실패를 0으로 되돌린다', () => {
    const t = make();
    t.fail();
    t.fail();
    t.circuit.record(t.circuit.tryAcquire()!, 'success');
    t.fail();
    t.fail();
    expect(t.circuit.isOpen()).toBe(false);
    t.fail();
    expect(t.circuit.isOpen()).toBe(true);
  });

  it('중립 결과는 몇 번이어도 개방하지 않고 연속 실패도 건드리지 않는다', () => {
    const t = make();
    t.fail();
    t.fail();
    for (let i = 0; i < 20; i += 1) t.circuit.record(t.circuit.tryAcquire()!, 'neutral');
    expect(t.circuit.isOpen()).toBe(false);
    t.fail(); // 중립이 카운트를 지우지 않았으므로 3번째 인프라 실패로 개방
    expect(t.circuit.isOpen()).toBe(true);
  });

  it('half-open — 개방 시간이 지나면 첫 호출만 탐침으로 통과 · 동시 두 번째는 거부', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    expect(t.circuit.isOpen()).toBe(false); // 읽기 전용 확인은 탐침을 소모하지 않는다
    const probe = t.circuit.tryAcquire();
    expect(probe).toMatchObject({ probe: true });
    expect(t.circuit.tryAcquire()).toBeNull();
    expect(t.circuit.tryAcquire()).toBeNull();
  });

  it('탐침 성공 → 닫힘(연속 실패 0) · 이후 통과', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    t.circuit.record(t.circuit.tryAcquire()!, 'success');
    expect(t.events).toEqual(['OPENED', 'CLOSED']);
    expect(t.circuit.tryAcquire()).toMatchObject({ probe: false });
    t.fail();
    t.fail();
    expect(t.circuit.isOpen()).toBe(false); // 0부터 다시 센다
  });

  it('탐침 중립(4xx·형식 오류·출구 차단)은 임대만 풀고 상태 유지 — 다음 호출이 다시 탐침이다(회복 근거는 성공뿐)', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    const first = t.circuit.tryAcquire()!;
    expect(t.circuit.tryAcquire()).toBeNull(); // 탐침 중에는 거부
    t.circuit.record(first, 'neutral');
    expect(t.events).toEqual(['OPENED']); // 닫히지 않았다
    // 임대가 풀려 다음 호출이 바로 새 탐침이 된다(개방 시간을 다시 기다리지 않는다).
    const second = t.circuit.tryAcquire();
    expect(second).toMatchObject({ probe: true });
    expect(t.circuit.tryAcquire()).toBeNull();
    // 중립을 여러 번 반복해도 닫히지 않는다 · 연속 실패 카운트도 그대로다.
    t.circuit.record(second!, 'neutral');
    t.circuit.record(t.circuit.tryAcquire()!, 'neutral');
    expect(t.events).toEqual(['OPENED']);
    // 성공이 오면 그때 닫힌다.
    t.circuit.record(t.circuit.tryAcquire()!, 'success');
    expect(t.events).toEqual(['OPENED', 'CLOSED']);
  });

  it('탐침 중립 뒤 인프라 실패 탐침이면 재개방한다', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    t.circuit.record(t.circuit.tryAcquire()!, 'neutral');
    t.circuit.record(t.circuit.tryAcquire()!, 'infra');
    expect(t.events).toEqual(['OPENED', 'PROBE_FAILED']);
    expect(t.circuit.tryAcquire()).toBeNull();
  });

  it('탐침 인프라 실패 → 다시 개방 openMs', () => {
    const t = make();
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    t.circuit.record(t.circuit.tryAcquire()!, 'infra');
    expect(t.events).toEqual(['OPENED', 'PROBE_FAILED']);
    expect(t.circuit.tryAcquire()).toBeNull();
    t.clock.t += 59_999;
    expect(t.circuit.tryAcquire()).toBeNull();
    t.clock.t += 1;
    expect(t.circuit.tryAcquire()).toMatchObject({ probe: true });
  });

  it('개방 전에 시작된 호출의 늦은 실패·성공은 개방 시간을 연장하지도 닫지도 않는다', () => {
    const t = make();
    const late = t.circuit.tryAcquire()!; // 닫힘 시절 시작한 느린 호출
    t.fail();
    t.fail();
    t.fail(); // 개방
    const openUntilProbe = (): boolean => t.circuit.isOpen();
    t.clock.t += 30_000;
    t.circuit.record(late, 'infra');
    t.circuit.record(late, 'success');
    expect(openUntilProbe()).toBe(true);
    t.clock.t += 30_000; // 처음 개방에서 60초 — 연장됐다면 아직 열려 있다
    expect(t.circuit.isOpen()).toBe(false);
    expect(t.events).toEqual(['OPENED']);
  });

  it('탐침 임대 — 탐침이 기록 없이 사라져도 임대가 끝나면 다음 호출을 새 탐침으로 허용한다 · 옛 탐침의 늦은 결과는 무시', () => {
    const t = make({ probeLeaseMs: 35_000 });
    t.fail();
    t.fail();
    t.fail();
    t.clock.t += 60_000;
    const lost = t.circuit.tryAcquire()!;
    t.clock.t += 34_999;
    expect(t.circuit.tryAcquire()).toBeNull();
    t.clock.t += 1;
    const next = t.circuit.tryAcquire();
    expect(next).toMatchObject({ probe: true });
    t.circuit.record(lost, 'success'); // 옛 탐침 — 무시
    expect(t.events).toEqual(['OPENED']);
    t.circuit.record(next!, 'success');
    expect(t.events).toEqual(['OPENED', 'CLOSED']);
  });

  it('threshold 1이면 첫 인프라 실패로 개방', () => {
    const t = make({ threshold: 1 });
    t.fail();
    expect(t.circuit.isOpen()).toBe(true);
  });

  describe('classifyCircuitFailure — 계수 분류', () => {
    it.each([
      ['TIMEOUT', undefined, 'infra'],
      ['NETWORK', undefined, 'infra'],
      ['HTTP_5XX', 503, 'infra'],
      ['HTTP_4XX', 429, 'infra'],
      ['HTTP_4XX', 400, 'neutral'],
      ['HTTP_4XX', undefined, 'neutral'],
      ['INVALID_RESPONSE', undefined, 'neutral'],
      ['EGRESS_BLOCKED', undefined, 'neutral'],
    ] as const)('%s(%s) → %s', (cause, status, expected) => {
      expect(classifyCircuitFailure(cause, status)).toBe(expected);
    });
  });
});
