import { computeNextRunAt } from './schedule-next';

// 상대 시각 원칙(CLAUDE.md·§17.2) — 절대 날짜 리터럴 대신 "지금부터 KST 기준" 계산으로 만든다.
describe('computeNextRunAt', () => {
  it('MANUAL은 null', () => {
    expect(computeNextRunAt({ kind: 'MANUAL' }, new Date())).toBeNull();
  });

  it('DAILY — 오늘 KST 시각이 아직 안 지났으면 오늘, 지났으면 내일', () => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 540 * 60_000);
    const futureHour = (kstNow.getUTCHours() + 2) % 24;
    const time = `${String(futureHour).padStart(2, '0')}:00`;
    const next = computeNextRunAt({ kind: 'DAILY', time }, now);
    expect(next).not.toBeNull();
    expect((next as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it('DAILY — 1회만 따라잡는다(과거 시각이면 내일로 건너뛴다)', () => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 540 * 60_000);
    const pastHour = (kstNow.getUTCHours() + 23) % 24; // 1시간 전(이미 지난 시각)
    const time = `${String(pastHour).padStart(2, '0')}:00`;
    const next = computeNextRunAt({ kind: 'DAILY', time }, now) as Date;
    const diffHours = (next.getTime() - now.getTime()) / 3_600_000;
    expect(diffHours).toBeGreaterThan(0);
    expect(diffHours).toBeLessThan(48);
  });

  it('WEEKLY — 다음 발생은 항상 미래다', () => {
    const now = new Date();
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const next = computeNextRunAt({ kind: 'WEEKLY', weekday, time: '03:00' }, now) as Date;
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(8 * 24 * 3_600_000);
    }
  });
});
