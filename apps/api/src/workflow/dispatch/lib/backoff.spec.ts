import { computeBackoffMs, parseBackoffSchedule } from './backoff';

describe('No.41 백오프(§7.5)', () => {
  it('parseBackoffSchedule — "30s,2m,10m,30m,2h"를 ms 배열로 변환한다', () => {
    expect(parseBackoffSchedule('30s,2m,10m,30m,2h')).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000]);
  });

  it('random=0(하한 -20%) — schedule * 0.8', () => {
    expect(computeBackoffMs([30_000], 1, () => 0)).toBe(24_000);
  });

  it('random=1(상한 +20%) — schedule * 1.2', () => {
    expect(computeBackoffMs([30_000], 1, () => 1)).toBe(36_000);
  });

  it('attemptNumber가 schedule 길이를 넘으면 마지막 값을 반복한다', () => {
    const schedule = [30_000, 120_000];
    expect(computeBackoffMs(schedule, 10, () => 0)).toBe(Math.round(120_000 * 0.8));
  });

  it('attemptNumber=1 → schedule[0] 사용', () => {
    expect(computeBackoffMs([30_000, 120_000], 1, () => 0.5)).toBe(30_000);
  });
});
