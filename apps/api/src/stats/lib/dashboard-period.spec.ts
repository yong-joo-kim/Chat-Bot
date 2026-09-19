import { InvalidPeriodError, resolveDashboardPeriod } from './dashboard-period';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('resolveDashboardPeriod', () => {
  it('defaults to the most recent 7 KST calendar days when from/to are omitted (FR-2-6, AC-2-7)', () => {
    const now = new Date('2026-03-10T04:30:00.000Z'); // KST 2026-03-10 13:30
    const { periodStart, periodEnd } = resolveDashboardPeriod(undefined, undefined, now);

    const spanDays = (periodEnd.getTime() - periodStart.getTime() + 1) / MS_PER_DAY;
    expect(spanDays).toBe(7);
  });

  it('periodStart is exactly KST 00:00:00.000 and periodEnd is KST 23:59:59.999', () => {
    const now = new Date('2026-03-10T04:30:00.000Z');
    const { periodStart, periodEnd } = resolveDashboardPeriod(undefined, undefined, now);

    const KST_OFFSET_MS = 540 * 60 * 1000;
    expect((periodStart.getTime() + KST_OFFSET_MS) % MS_PER_DAY).toBe(0);
    expect((periodEnd.getTime() + KST_OFFSET_MS + 1) % MS_PER_DAY).toBe(0);
  });

  it('rejects when from is after to (FR-2-8, AC-2-8)', () => {
    const to = new Date('2025-01-01T00:00:00+09:00');
    const from = new Date('2025-01-02T00:00:00+09:00');
    expect(() => resolveDashboardPeriod(from, to, to)).toThrow(InvalidPeriodError);
  });

  it('allows exactly 366 inclusive days (AC-2-8 경계값)', () => {
    const from = new Date('2025-01-01T12:00:00+09:00');
    const to = new Date(from.getTime() + 365 * MS_PER_DAY);
    expect(() => resolveDashboardPeriod(from, to, to)).not.toThrow();
  });

  it('rejects periods longer than 366 days (FR-2-8, AC-2-8)', () => {
    const from = new Date('2025-01-01T12:00:00+09:00');
    const to = new Date(from.getTime() + 366 * MS_PER_DAY);
    expect(() => resolveDashboardPeriod(from, to, to)).toThrow(InvalidPeriodError);
  });

  it('honors explicit from/to spanning a single day', () => {
    const day = new Date('2026-05-05T09:00:00+09:00');
    const { periodStart, periodEnd } = resolveDashboardPeriod(day, day, day);
    const spanDays = (periodEnd.getTime() - periodStart.getTime() + 1) / MS_PER_DAY;
    expect(spanDays).toBe(1);
  });
});
