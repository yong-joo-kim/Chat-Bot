import { allocateShares, assembleBreakdown } from './breakdown';
import type { BreakdownSourceRow } from './breakdown';

describe('allocateShares (No.29 §5.5, AC-I2-6 — 최대 잔여법)', () => {
  it('sums to exactly the scale for arbitrary positive counts', () => {
    const units = allocateShares([1, 1, 1]);
    expect(units.reduce((s, u) => s + u, 0)).toBe(10_000);
  });

  it('returns all zeros when total is 0', () => {
    expect(allocateShares([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('breaks ties by input order (determinism)', () => {
    // 3등분 — 소수부가 모두 동일(.333...)하므로 입력 순서로 잔여 1단위를 배분한다.
    const units = allocateShares([1, 1, 1], 10);
    expect(units.reduce((s, u) => s + u, 0)).toBe(10);
    expect(units[0]).toBeGreaterThanOrEqual(units[1]);
  });

  it('property: 1,000 random count sets always sum to scale exactly', () => {
    let state = 42;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = 0; i < 1000; i += 1) {
      const n = 1 + Math.floor(rand() * 10);
      const counts = Array.from({ length: n }, () => Math.floor(rand() * 1000));
      const units = allocateShares(counts);
      const total = counts.reduce((s, c) => s + c, 0);
      const sum = units.reduce((s, u) => s + u, 0);
      expect(sum).toBe(total === 0 ? 0 : 10_000);
    }
  });
});

interface Extra {
  tag: string;
}

function row(id: string, name: string, turnCount: number, answeredCount: number, sessionCount: number): BreakdownSourceRow<Extra> {
  return { id, name, turnCount, answeredCount, sessionCount, extra: { tag: id } };
}

describe('assembleBreakdown (No.29 §5.5, J-7)', () => {
  it('sorts by turnCount desc → name asc → id asc', () => {
    const rows = [row('b', 'B', 5, 5, 1), row('a', 'A', 10, 5, 1), row('c', 'C', 10, 5, 1)];
    const result = assembleBreakdown(rows, { maxRows: 200 });
    expect(result.items.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('caps at maxRows and folds the remainder into othersRow (AC-I2-7 — turn 합 보존)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`id${i}`, `name${i}`, 10 - i, 5, 1));
    const result = assembleBreakdown(rows, { maxRows: 3 });
    expect(result.items).toHaveLength(3);
    expect(result.othersRow).not.toBeNull();
    expect(result.othersRow!.count).toBe(2);

    const itemTurnSum = result.items.reduce((s, r) => s + r.turnCount, 0);
    const totalTurnSum = itemTurnSum + (result.othersRow?.turnCount ?? 0);
    const expectedTotal = rows.reduce((s, r) => s + r.turnCount, 0);
    expect(totalTurnSum).toBe(expectedTotal);
  });

  it('adds an unassignedRow when provided, and share units still sum to 1', () => {
    const rows = [row('a', 'A', 10, 5, 2)];
    const result = assembleBreakdown(rows, { maxRows: 200, unassigned: { turnCount: 5, answeredCount: 0, sessionCount: 1 } });
    expect(result.unassignedRow).not.toBeNull();
    const shareSum = result.items.reduce((s, r) => s + r.share, 0) + (result.unassignedRow?.share ?? 0);
    expect(Math.round(shareSum * 10_000)).toBe(10_000);
  });

  it('computes unansweredCount and responseRate per row', () => {
    const rows = [row('a', 'A', 10, 4, 1)];
    const result = assembleBreakdown(rows, { maxRows: 200 });
    expect(result.items[0].unansweredCount).toBe(6);
    expect(result.items[0].responseRate).toBe(0.4);
  });

  it('returns null othersRow/unassignedRow when there is nothing to fold', () => {
    const result = assembleBreakdown([row('a', 'A', 1, 1, 1)], { maxRows: 200 });
    expect(result.othersRow).toBeNull();
    expect(result.unassignedRow).toBeNull();
  });
});
