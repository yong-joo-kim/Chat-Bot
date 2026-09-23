import { planTick } from './tick-planner';
import type { DueScheduleRow, HeldScheduleRow, TickPlannerConfig } from './tick-planner';

const BASE = new Date('2027-01-01T00:00:00Z');
const CFG: TickPlannerConfig = { misfireGraceMs: 10 * 60_000, pollIntervalMs: 30_000, retryWindowMs: 15 * 60_000, leaseMs: 5 * 60_000 };

function row(overrides: Partial<DueScheduleRow>): DueScheduleRow {
  return {
    id: 'sched-1',
    chatbotId: 'bot-1',
    status: 'PENDING',
    scheduledAt: BASE,
    attemptCount: 0,
    claimedAt: null,
    claimToken: null,
    ...overrides,
  };
}

const nowAfter = (ms: number) => new Date(BASE.getTime() + ms);

describe('planTick(§7.2, §18 필수 케이스)', () => {
  it('도래 선정 — 정시 도래한 PENDING은 EXECUTE다', () => {
    const decisions = planTick([row({})], [], BASE, CFG);
    expect(decisions).toEqual([{ kind: 'EXECUTE', id: 'sched-1', expectAttemptCount: 0 }]);
  });

  it('챗봇당 1건 — 같은 챗봇에 여러 PENDING이 있어도 가장 이른 것 1개만 결정한다', () => {
    const rows = [
      row({ id: 'a', scheduledAt: new Date(BASE.getTime() + 60_000) }),
      row({ id: 'b', scheduledAt: BASE }),
    ];
    const decisions = planTick(rows, [], nowAfter(120_000), CFG);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'EXECUTE', id: 'b' });
  });

  it('RUNNING 챗봇은(임대 유효) 건너뛴다(SKIP) — 다른 PENDING도 이번 tick에 실행하지 않는다', () => {
    const rows = [
      row({ id: 'running-1', status: 'RUNNING', claimedAt: nowAfter(0), claimToken: 'tok-1' }),
      row({ id: 'pending-1', scheduledAt: BASE }),
    ];
    const decisions = planTick(rows, [], nowAfter(10_000), CFG);
    expect(decisions).toEqual([{ kind: 'SKIP', id: 'running-1' }]);
  });

  it('임대 만료된 RUNNING → RECOVER', () => {
    const rows = [row({ id: 'running-1', status: 'RUNNING', claimedAt: BASE, claimToken: 'tok-1' })];
    const decisions = planTick(rows, [], nowAfter(CFG.leaseMs + 1), CFG);
    expect(decisions).toEqual([{ kind: 'RECOVER', id: 'running-1', claimToken: 'tok-1' }]);
  });

  it('가장 이른 PENDING보다 이른 HELD가 있으면 HOLD_BEHIND_HELD', () => {
    const rows = [row({ id: 'p1', scheduledAt: nowAfter(60_000) })];
    const held: HeldScheduleRow[] = [{ id: 'held-1', chatbotId: 'bot-1', scheduledAt: BASE }];
    const decisions = planTick(rows, held, nowAfter(120_000), CFG);
    expect(decisions).toEqual([{ kind: 'HOLD_BEHIND_HELD', id: 'p1', heldByScheduleId: 'held-1' }]);
  });

  describe('misfire 경계(유예 10분)', () => {
    it('+7분 지연 → EXECUTE(지연 ≈420초)', () => {
      const decisions = planTick([row({})], [], nowAfter(7 * 60_000), CFG);
      expect(decisions[0].kind).toBe('EXECUTE');
    });
    it('+10분20초(한계값 안) → EXECUTE', () => {
      const decisions = planTick([row({})], [], nowAfter(10 * 60_000 + 20_000), CFG);
      expect(decisions[0].kind).toBe('EXECUTE');
    });
    it('+10분36초(한계값 초과) → MISSED', () => {
      const decisions = planTick([row({})], [], nowAfter(10 * 60_000 + 36_000), CFG);
      expect(decisions[0]).toMatchObject({ kind: 'MISS' });
    });
  });

  describe('misfire 경계(유예 0)', () => {
    const cfgNoGrace: TickPlannerConfig = { ...CFG, misfireGraceMs: 0 };
    it('+10초(허용오차 35초 안) → EXECUTE', () => {
      const decisions = planTick([row({})], [], nowAfter(10_000), cfgNoGrace);
      expect(decisions[0].kind).toBe('EXECUTE');
    });
    it('+36초(허용오차 초과) → MISSED', () => {
      const decisions = planTick([row({})], [], nowAfter(36_000), cfgNoGrace);
      expect(decisions[0]).toMatchObject({ kind: 'MISS' });
    });
  });

  describe('재시도 창 경계(15분, 시도 ≥1회)', () => {
    it('+14분59초 → EXECUTE(재시도 계속)', () => {
      const decisions = planTick([row({ attemptCount: 1 })], [], nowAfter(14 * 60_000 + 59_000), CFG);
      expect(decisions[0]).toMatchObject({ kind: 'EXECUTE', expectAttemptCount: 1 });
    });
    it('+15분1초 → EXPIRE_RETRY', () => {
      const decisions = planTick([row({ attemptCount: 1 })], [], nowAfter(15 * 60_000 + 1_000), CFG);
      expect(decisions[0]).toEqual({ kind: 'EXPIRE_RETRY', id: 'sched-1' });
    });
  });

  it('예약이 없으면 빈 배열(유휴 tick)', () => {
    expect(planTick([], [], BASE, CFG)).toEqual([]);
  });

  it('서로 다른 챗봇은 각자 독립적으로 결정된다', () => {
    const rows = [row({ id: 'a', chatbotId: 'bot-a' }), row({ id: 'b', chatbotId: 'bot-b' })];
    const decisions = planTick(rows, [], BASE, CFG);
    expect(decisions.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });
});
