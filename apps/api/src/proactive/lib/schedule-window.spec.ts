import { computePeriodState, computeShowUntil, isWithinPublishPeriod, isWithinScheduleWindow } from './schedule-window';

describe('computePeriodState', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');

  it('시작·종료 모두 없으면 ALWAYS', () => {
    expect(computePeriodState(null, null, now)).toBe('ALWAYS');
  });
  it('시작 전이면 SCHEDULED', () => {
    expect(computePeriodState(new Date('2026-11-01T00:00:00.000Z'), null, now)).toBe('SCHEDULED');
  });
  it('종료 후면 ENDED', () => {
    expect(computePeriodState(null, new Date('2026-10-01T00:00:00.000Z'), now)).toBe('ENDED');
  });
  it('기간 안이면 ACTIVE', () => {
    expect(computePeriodState(new Date('2026-10-01T00:00:00.000Z'), new Date('2026-11-01T00:00:00.000Z'), now)).toBe('ACTIVE');
  });
  it('종료 시각과 정확히 같으면 ENDED(경계 포함)', () => {
    expect(computePeriodState(null, now, now)).toBe('ENDED');
  });
});

describe('isWithinPublishPeriod', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');
  it('시작 전은 false', () => {
    expect(isWithinPublishPeriod(new Date('2026-10-16T00:00:00.000Z'), null, now)).toBe(false);
  });
  it('종료 후는 false', () => {
    expect(isWithinPublishPeriod(null, new Date('2026-10-14T00:00:00.000Z'), now)).toBe(false);
  });
  it('기간 안은 true', () => {
    expect(isWithinPublishPeriod(null, null, now)).toBe(true);
  });
});

describe('isWithinScheduleWindow — KST 요일·HH:mm 경계(상대 시각 원칙)', () => {
  // 2026-09-29(화)는 KST 화요일. UTC 2026-09-29T00:00:00Z = KST 2026-09-29 09:00.
  const tuesdayKst9am = new Date('2026-09-29T00:00:00.000Z');

  it('schedule이 없으면 항상 true', () => {
    expect(isWithinScheduleWindow(null, tuesdayKst9am)).toBe(true);
  });

  it('요일이 맞고 시간대 안이면 true', () => {
    // 화요일 = weekday 1(0=월). 09:00~18:00 창 안.
    const schedule = { days: [1], from: '09:00', to: '18:00' };
    expect(isWithinScheduleWindow(schedule, tuesdayKst9am)).toBe(true);
  });

  it('요일이 다르면 false', () => {
    const schedule = { days: [0], from: '00:00', to: '23:59' }; // 월요일만
    expect(isWithinScheduleWindow(schedule, tuesdayKst9am)).toBe(false);
  });

  it('시간대 밖이면 false(경계: to는 미포함)', () => {
    const schedule = { days: [1], from: '00:00', to: '09:00' };
    expect(isWithinScheduleWindow(schedule, tuesdayKst9am)).toBe(false);
  });

  it('from 경계는 포함(같은 분)', () => {
    const schedule = { days: [1], from: '09:00', to: '09:01' };
    expect(isWithinScheduleWindow(schedule, tuesdayKst9am)).toBe(true);
  });
});

describe('computeShowUntil', () => {
  const tuesdayKst9am = new Date('2026-09-29T00:00:00.000Z');

  it('둘 다 없으면 undefined', () => {
    expect(computeShowUntil(null, null, tuesdayKst9am)).toBeUndefined();
  });

  it('endsAt만 있으면 그 시각', () => {
    const endsAt = new Date('2026-10-01T00:00:00.000Z');
    expect(computeShowUntil(endsAt, null, tuesdayKst9am)?.getTime()).toBe(endsAt.getTime());
  });

  it('schedule만 있으면 오늘 KST 종료 시각(18:00 KST = 09:00 UTC)', () => {
    const schedule = { days: [1], from: '09:00', to: '18:00' };
    const result = computeShowUntil(null, schedule, tuesdayKst9am);
    expect(result?.toISOString()).toBe('2026-09-29T09:00:00.000Z');
  });

  it('둘 다 있으면 더 이른 시각', () => {
    const schedule = { days: [1], from: '09:00', to: '18:00' }; // → 09:00Z
    const endsAt = new Date('2026-09-29T05:00:00.000Z'); // 더 이름
    const result = computeShowUntil(endsAt, schedule, tuesdayKst9am);
    expect(result?.getTime()).toBe(endsAt.getTime());
  });

  it('오늘이 schedule.days에 없으면 endsAt만 반영', () => {
    const schedule = { days: [0], from: '09:00', to: '18:00' }; // 월요일만
    const endsAt = new Date('2026-10-01T00:00:00.000Z');
    const result = computeShowUntil(endsAt, schedule, tuesdayKst9am);
    expect(result?.getTime()).toBe(endsAt.getTime());
  });
});
