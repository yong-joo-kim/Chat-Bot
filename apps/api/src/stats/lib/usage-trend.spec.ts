import { foldByHour, foldByWeekday, foldSessionCountsByBucket, foldSessionCountsByChannel } from './usage-trend';

describe('foldByHour (FR-14-28, AC-14B-5)', () => {
  it('always returns 24 entries, zero-filled for missing hours', () => {
    const result = foldByHour([{ hour: 10, count: 5 }]);
    expect(result).toHaveLength(24);
    expect(result[10]).toEqual({ hour: 10, turnCount: 5 });
    expect(result[0]).toEqual({ hour: 0, turnCount: 0 });
  });

  it('sums duplicate hour rows', () => {
    const result = foldByHour([
      { hour: 9, count: 2 },
      { hour: 9, count: 3 },
    ]);
    expect(result[9].turnCount).toBe(5);
  });
});

describe('foldByWeekday (FR-14-29, AC-14B-5)', () => {
  it('always returns 7 entries with responseRate derived per weekday', () => {
    const result = foldByWeekday([
      { dayBucket: '2026-09-21', isAnswered: true, count: 8 }, // Monday
      { dayBucket: '2026-09-21', isAnswered: false, count: 2 },
    ]);
    expect(result).toHaveLength(7);
    expect(result[0]).toEqual({ weekday: 0, turnCount: 10, responseRate: 0.8 });
    expect(result[1]).toEqual({ weekday: 1, turnCount: 0, responseRate: 0 });
  });
});

describe('foldSessionCountsByBucket (DD-60/61 — bucket-level distinct, not a sum)', () => {
  it('counts distinct sessionIds per bucket and null sessions as 1 each', () => {
    const rows = [
      { dayBucket: '2026-09-21', channelType: 'WEB', sessionId: 's1', count: 3 },
      { dayBucket: '2026-09-21', channelType: 'WEB', sessionId: 's1', count: 1 }, // same session again
      { dayBucket: '2026-09-22', channelType: 'WEB', sessionId: 's2', count: 2 },
      { dayBucket: '2026-09-21', channelType: 'WEB', sessionId: null, count: 2 },
    ];
    const folded = foldSessionCountsByBucket(rows, 'DAY');
    expect(folded.get('2026-09-21')).toBe(3); // s1(1 distinct) + 2 null rows
    expect(folded.get('2026-09-22')).toBe(1);
  });
});

describe('foldSessionCountsByChannel (FR-14-15)', () => {
  it('counts distinct sessions per channel', () => {
    const rows = [
      { dayBucket: '', channelType: 'WEB', sessionId: 'a', count: 1 },
      { dayBucket: '', channelType: 'WEB', sessionId: 'b', count: 1 },
      { dayBucket: '', channelType: 'KAKAOTALK', sessionId: 'c', count: 1 },
    ];
    const folded = foldSessionCountsByChannel(rows);
    expect(folded.get('WEB')).toBe(2);
    expect(folded.get('KAKAOTALK')).toBe(1);
  });
});
