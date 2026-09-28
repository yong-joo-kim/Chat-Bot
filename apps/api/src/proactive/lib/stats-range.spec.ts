import { resolveProactiveStatsRange } from './stats-range';

describe('resolveProactiveStatsRange', () => {
  // KST 2026-09-29 09:00 = UTC 2026-09-29T00:00:00Z → 오늘(KST) 버킷은 2026-09-29.
  const now = new Date('2026-09-29T00:00:00.000Z');

  it('아무것도 지정하지 않으면 최근 7일(오늘 포함)', () => {
    expect(resolveProactiveStatsRange(undefined, undefined, now)).toEqual({ from: '2026-09-23', to: '2026-09-29' });
  });

  it('지정한 from/to를 그대로 쓴다(범위 안이면)', () => {
    expect(resolveProactiveStatsRange('2026-09-01', '2026-09-10', now)).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('to가 오늘보다 미래면 오늘로 자른다', () => {
    expect(resolveProactiveStatsRange(undefined, '2026-12-31', now)).toEqual({ from: '2026-09-23', to: '2026-09-29' });
  });

  it('from이 90일보다 더 과거면 최대 기간(90일 창)으로 자른다', () => {
    const result = resolveProactiveStatsRange('2000-01-01', '2026-09-29', now);
    expect(result.to).toBe('2026-09-29');
    expect(result.from).toBe('2026-07-02');
  });

  it('from이 to보다 미래면 to로 맞춘다', () => {
    expect(resolveProactiveStatsRange('2026-10-01', '2026-09-01', now)).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });
});
