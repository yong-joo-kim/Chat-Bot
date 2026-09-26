import { planClaims } from './claim-plan';

describe('No.41 선점 계획(§7.2)', () => {
  const opts = { batch: 20, targetConcurrentSending: 2, targetRatePerMin: 60, instanceConcurrentSends: 10 };

  it('대상 꺼짐 → SKIPPED', () => {
    const plan = planClaims([{ id: 'r1', targetId: 't1' }], new Map([['t1', { enabled: false, paused: false, sendingCount: 0, recentAttempts: 0 }]]), opts);
    expect(plan.get('r1')).toBe('SKIPPED');
  });

  it('대상 없음 → SKIPPED', () => {
    const plan = planClaims([{ id: 'r1', targetId: 'missing' }], new Map(), opts);
    expect(plan.get('r1')).toBe('SKIPPED');
  });

  it('대상 정지 → HELD', () => {
    const plan = planClaims([{ id: 'r1', targetId: 't1' }], new Map([['t1', { enabled: true, paused: true, sendingCount: 0, recentAttempts: 0 }]]), opts);
    expect(plan.get('r1')).toBe('HELD');
  });

  it('대상 동시 SENDING 상한(2) 초과 → DEFER', () => {
    const targets = new Map([['t1', { enabled: true, paused: false, sendingCount: 2, recentAttempts: 0 }]]);
    const plan = planClaims([{ id: 'r1', targetId: 't1' }], targets, opts);
    expect(plan.get('r1')).toBe('DEFER');
  });

  it('같은 tick 안에서 동시 상한을 누적 계산한다(2건 요청 시 1건만 CLAIM)', () => {
    const targets = new Map([['t1', { enabled: true, paused: false, sendingCount: 1, recentAttempts: 0 }]]);
    const plan = planClaims(
      [
        { id: 'r1', targetId: 't1' },
        { id: 'r2', targetId: 't1' },
      ],
      targets,
      opts,
    );
    expect(plan.get('r1')).toBe('CLAIM');
    expect(plan.get('r2')).toBe('DEFER');
  });

  it('배치 상한 초과분은 DEFER', () => {
    const targets = new Map([['t1', { enabled: true, paused: false, sendingCount: 0, recentAttempts: 0 }]]);
    const candidates = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, targetId: 't1' }));
    const plan = planClaims(candidates, targets, { ...opts, batch: 2, targetConcurrentSending: 10 });
    expect(plan.get('r0')).toBe('CLAIM');
    expect(plan.get('r1')).toBe('CLAIM');
    expect(plan.get('r2')).toBe('DEFER');
  });

  it('정상 대상은 CLAIM', () => {
    const targets = new Map([['t1', { enabled: true, paused: false, sendingCount: 0, recentAttempts: 0 }]]);
    const plan = planClaims([{ id: 'r1', targetId: 't1' }], targets, opts);
    expect(plan.get('r1')).toBe('CLAIM');
  });
});
