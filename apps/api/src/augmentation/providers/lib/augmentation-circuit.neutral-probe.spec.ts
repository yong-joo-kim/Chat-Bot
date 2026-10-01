import { AugmentationCircuit, type CircuitTransition } from './augmentation-circuit';

/**
 * [K-1c 개정 ① 재검증 — test-automation 2026-10-01] 탐침이 중립(4xx·형식 오류·출구 차단)으로 끝나면 **임대만 풀리고** 상태는 그대로다.
 * 가짜 시계 · 전이 콜백 기록으로 "상태 유지"(연속 실패 수 · 개방 시각 · 전이 0건)를 직접 확인한다.
 */
function make(threshold = 2, openMs = 1000) {
  let t = 10_000;
  const events: CircuitTransition[] = [];
  const c = new AugmentationCircuit({ threshold, openMs, now: () => t, onTransition: (e) => events.push(e) });
  return { c, events, advance: (ms: number) => (t += ms) };
}

describe('AugmentationCircuit — 탐침 중립(적대적 확인)', () => {
  it('half-open 탐침이 중립이면 임대만 풀린다: 전이 0건 · 즉시 다음 호출이 다시 탐침 · 동시 호출은 여전히 거부', () => {
    const { c, events, advance } = make();
    for (let i = 0; i < 2; i++) c.record(c.tryAcquire()!, 'infra');
    expect(events).toEqual(['OPENED']);
    advance(1000); // half-open
    const p1 = c.tryAcquire()!;
    expect(p1.probe).toBe(true);
    expect(c.tryAcquire()).toBeNull(); // 탐침 진행 중 — 거부
    c.record(p1, 'neutral');
    expect(events).toEqual(['OPENED']); // 닫힘·재개방 전이 없음
    expect(c.isOpen()).toBe(false); // half-open 그대로(열림 시간 연장 없음)
    const p2 = c.tryAcquire()!; // 임대 해제 → 다시 탐침
    expect(p2.probe).toBe(true);
    expect(c.tryAcquire()).toBeNull();
    // 탐침이 인프라 실패이면 재개방(연속 실패 수가 유지되어 있어도 즉시 재개방)
    c.record(p2, 'infra');
    expect(events).toEqual(['OPENED', 'PROBE_FAILED']);
    expect(c.isOpen()).toBe(true);
  });

  it('중립 탐침을 몇 번 반복해도 닫히지 않는다 — 회복은 성공 탐침뿐 · 성공하면 연속 실패 0', () => {
    const { c, events, advance } = make(2, 1000);
    for (let i = 0; i < 2; i++) c.record(c.tryAcquire()!, 'infra');
    advance(1000);
    for (let i = 0; i < 25; i++) c.record(c.tryAcquire()!, 'neutral');
    expect(events).toEqual(['OPENED']);
    c.record(c.tryAcquire()!, 'success');
    expect(events).toEqual(['OPENED', 'CLOSED']);
    // 닫힘 후 연속 실패는 0부터 — 1회 실패로는 개방하지 않는다
    c.record(c.tryAcquire()!, 'infra');
    expect(c.isOpen()).toBe(false);
  });

  it('중립으로 풀린 옛 탐침 허가증이 뒤늦게 기록되어도 새 탐침 상태를 건드리지 않는다', () => {
    const { c, events, advance } = make(1, 1000);
    c.record(c.tryAcquire()!, 'infra');
    advance(1000);
    const old = c.tryAcquire()!;
    c.record(old, 'neutral');
    const fresh = c.tryAcquire()!;
    c.record(old, 'success'); // 이미 풀린 허가증의 늦은 기록 — 무시되어야 한다
    expect(events).toEqual(['OPENED']);
    expect(c.tryAcquire()).toBeNull(); // 새 탐침(fresh)이 아직 진행 중
    c.record(fresh, 'success');
    expect(events).toEqual(['OPENED', 'CLOSED']);
  });

  it('닫힘 상태의 중립은 연속 실패를 건드리지 않는다(5xx, 중립, 5xx → 임계 2 개방)', () => {
    const { c, events } = make(2, 1000);
    c.record(c.tryAcquire()!, 'infra');
    c.record(c.tryAcquire()!, 'neutral');
    c.record(c.tryAcquire()!, 'infra');
    expect(events).toEqual(['OPENED']);
  });
});
