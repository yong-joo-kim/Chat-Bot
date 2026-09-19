import { deriveCopyName } from './copy-name.util';

describe('deriveCopyName', () => {
  it('appends " (사본)" for normal length names (AC-1-7)', () => {
    expect(deriveCopyName('주문봇')).toBe('주문봇 (사본)');
  });

  it('keeps the total length within 100 characters when the name is long', () => {
    const longName = 'a'.repeat(100);
    const result = deriveCopyName(longName);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith(' (사본)')).toBe(true);
  });

  it('trims trailing whitespace introduced by clamping before appending the suffix', () => {
    const name = `${'가'.repeat(94)}   `; // 97자 — 94자 + 공백 3칸
    const result = deriveCopyName(name);
    expect(result).toBe(`${'가'.repeat(94)} (사본)`);
  });
});
