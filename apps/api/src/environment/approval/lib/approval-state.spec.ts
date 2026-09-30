import { canDecide, computeExpiresAt, effectiveVerdict } from './approval-state';
import type { EffectiveContext, PendingRequestFacts } from './approval-state';

const NOW = new Date('2026-09-30T00:00:00.000Z');
const HOUR = 3_600_000;

const immediate: PendingRequestFacts = {
  action: 'PROD_SWITCH',
  expiresAt: new Date(NOW.getTime() + 24 * HOUR),
  baseProdVersionId: 'v-base',
  deployScheduleId: null,
  targetVersionId: 'v-target',
};

const ctx = (overrides: Partial<EffectiveContext> = {}): EffectiveContext => ({ policyRequired: true, currentProdVersionId: 'v-base', schedule: null, ...overrides });

describe('effectiveVerdict — 조회·변경 시점 유효 상태(설계서 §10.3)', () => {
  it('정책 켜짐 · 기준 같음 · 만료 전이면 대기', () => {
    expect(effectiveVerdict(immediate, NOW, ctx())).toEqual({ kind: 'PENDING' });
  });

  it('정책이 꺼졌으면 CANCELLED(POLICY_OFF)', () => {
    expect(effectiveVerdict(immediate, NOW, ctx({ policyRequired: false }))).toEqual({ kind: 'CANCELLED', closedReason: 'POLICY_OFF' });
  });

  it('만료 시각 도달 = EXPIRED(경계 포함)', () => {
    expect(effectiveVerdict({ ...immediate, expiresAt: NOW }, NOW, ctx())).toEqual({ kind: 'EXPIRED' });
    expect(effectiveVerdict({ ...immediate, expiresAt: new Date(NOW.getTime() + 1) }, NOW, ctx())).toEqual({ kind: 'PENDING' });
  });

  it('운영 포인터가 바뀌면 CANCELLED(BASE_CHANGED)', () => {
    expect(effectiveVerdict(immediate, NOW, ctx({ currentProdVersionId: 'v-other' }))).toEqual({ kind: 'CANCELLED', closedReason: 'BASE_CHANGED' });
    expect(effectiveVerdict(immediate, NOW, ctx({ currentProdVersionId: null }))).toEqual({ kind: 'CANCELLED', closedReason: 'BASE_CHANGED' });
  });

  describe('예약 요청', () => {
    const scheduled: PendingRequestFacts = { ...immediate, action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: 's1' };
    const schedule = { status: 'PENDING', scheduledAt: new Date(NOW.getTime() + 2 * HOUR), targetVersionId: 'v-target', expectedProdVersionId: 'v-base' };

    it('예약이 대기·보류이고 시각 전이며 대상·기준이 같으면 대기(운영 포인터는 보지 않는다 — 체인 예약)', () => {
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule, currentProdVersionId: 'v-else' }))).toEqual({ kind: 'PENDING' });
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: { ...schedule, status: 'HELD' } }))).toEqual({ kind: 'PENDING' });
    });

    it('예약이 없거나 취소·실행·시각 경과면 SCHEDULE_INACTIVE', () => {
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: null }))).toEqual({ kind: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' });
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: { ...schedule, status: 'CANCELLED' } }))).toEqual({ kind: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' });
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: { ...schedule, scheduledAt: NOW } }))).toEqual({ kind: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' });
    });

    it('예약의 대상·기준이 요청과 달라지면 BASE_CHANGED', () => {
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: { ...schedule, expectedProdVersionId: 'v-new-base' } }))).toEqual({ kind: 'CANCELLED', closedReason: 'BASE_CHANGED' });
      expect(effectiveVerdict(scheduled, NOW, ctx({ schedule: { ...schedule, targetVersionId: 'v-new-target' } }))).toEqual({ kind: 'CANCELLED', closedReason: 'BASE_CHANGED' });
    });
  });
});

describe('computeExpiresAt', () => {
  it('요청 시각 + TTL(시간)', () => {
    expect(computeExpiresAt(NOW, 24).getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });

  it('예약 요청은 min(요청 + TTL, 예약 시각)', () => {
    const sooner = new Date(NOW.getTime() + 3 * HOUR);
    const later = new Date(NOW.getTime() + 48 * HOUR);
    expect(computeExpiresAt(NOW, 24, sooner)).toEqual(sooner);
    expect(computeExpiresAt(NOW, 24, later).getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });
});

describe('canDecide', () => {
  it('대기이고 요청자가 아닐 때만 승인·반려 가능', () => {
    expect(canDecide('PENDING', 'u1', 'u2')).toBe(true);
    expect(canDecide('PENDING', 'u1', 'u1')).toBe(false);
    expect(canDecide('APPROVED', 'u1', 'u2')).toBe(false);
  });
});
