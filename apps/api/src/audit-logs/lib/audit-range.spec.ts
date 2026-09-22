import { AuditRangeTooWideError, InvalidAuditRangeError, resolveAuditRange } from './audit-range';

const NOW = new Date('2026-09-21T00:00:00.000Z');

describe('resolveAuditRange — FR-13-17', () => {
  it('from/to 모두 생략하면 기본 30일 범위를 적용하고 defaulted:true다', () => {
    const range = resolveAuditRange(undefined, undefined, 90, NOW);
    expect(range.to.getTime()).toBe(NOW.getTime());
    expect(range.defaulted).toBe(true);
    const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
    expect(days).toBe(30);
  });

  it('명시적 from/to는 그대로 사용하고 defaulted:false다', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-10T00:00:00.000Z');
    const range = resolveAuditRange(from, to, 90, NOW);
    expect(range).toEqual({ from, to, defaulted: false });
  });

  it('상한(maxDays)을 초과하면 AuditRangeTooWideError를 던진다', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(() => resolveAuditRange(from, NOW, 90)).toThrow(AuditRangeTooWideError);
  });

  it('from이 to보다 늦으면 InvalidAuditRangeError를 던진다', () => {
    const from = new Date('2026-09-21T00:00:00.000Z');
    const to = new Date('2026-09-01T00:00:00.000Z');
    expect(() => resolveAuditRange(from, to, 90)).toThrow(InvalidAuditRangeError);
  });
});
