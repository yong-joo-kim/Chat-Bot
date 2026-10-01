import { isProductionRuntime } from '../../config/runtime-env';
import { NonBlockingSemaphore } from '../core/speech-concurrency';
import { SpeechAvailabilityCache } from '../core/speech-availability.cache';
import { aggregateVoiceStats, resolveVoiceStatsRange } from './stats-range';

describe('isProductionRuntime(DD-135 — 운영 판별의 유일한 정의)', () => {
  it.each([
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: ' production ' }, true],
    [{ NODE_ENV: 'Production' }, false],
    [{ NODE_ENV: 'PRODUCTION' }, false],
    [{ NODE_ENV: 'prod' }, false],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{ NODE_ENV: '' }, false],
    [{}, false],
    [{ NODE_ENV: undefined }, false],
  ])('%j → %s', (env, expected) => {
    expect(isProductionRuntime(env as Record<string, unknown>)).toBe(expected);
  });
});

describe('NonBlockingSemaphore(대기 없는 세마포어)', () => {
  it('자리가 없으면 즉시 null · 해제하면 다시 얻는다 · 해제는 1회만 반납', () => {
    const sem = new NonBlockingSemaphore(2);
    const a = sem.tryAcquire();
    const b = sem.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
    a!();
    a!(); // 이중 해제는 무시
    expect(sem.active).toBe(1);
    const c = sem.tryAcquire();
    expect(c).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
    b!();
    c!();
    expect(sem.active).toBe(0);
  });
});

describe('SpeechAvailabilityCache(성공 N · 실패 N/3)', () => {
  it('성공은 30초 · 실패는 10초 후 갱신이 필요하다', () => {
    let now = 0;
    const cache = new SpeechAvailabilityCache(30_000, () => now);
    expect(cache.peek()).toBeUndefined();
    expect(cache.needsRefresh()).toBe(true);

    cache.set(true);
    now = 29_999;
    expect(cache.needsRefresh()).toBe(false);
    now = 30_000;
    expect(cache.needsRefresh()).toBe(true);
    expect(cache.peek()).toBe(true); // 만료돼도 직전 값을 돌려준다

    cache.set(false);
    now = 30_000 + 9_999;
    expect(cache.needsRefresh()).toBe(false);
    now = 30_000 + 10_000;
    expect(cache.needsRefresh()).toBe(true);
  });

  it('인프라 실패 → 즉시 false', () => {
    const cache = new SpeechAvailabilityCache(30_000, () => 0);
    cache.set(true);
    cache.markUnavailable();
    expect(cache.peek()).toBe(false);
  });
});

describe('인식 숫자 기간·집계', () => {
  const now = new Date('2026-10-01T03:00:00Z'); // KST 12:00

  it('기본 최근 7일 · 오늘은 KST 기준', () => {
    expect(resolveVoiceStatsRange(undefined, undefined, now)).toEqual({ from: '2026-09-25', to: '2026-10-01' });
  });

  it('최대 90일로 줄이고 미래 to는 오늘로 · from>to는 to로 맞춘다', () => {
    expect(resolveVoiceStatsRange('2025-01-01', '2026-10-01', now)).toEqual({ from: '2026-07-04', to: '2026-10-01' });
    expect(resolveVoiceStatsRange('2026-09-01', '2027-01-01', now).to).toBe('2026-10-01');
    expect(resolveVoiceStatsRange('2026-10-01', '2026-09-20', now)).toEqual({ from: '2026-09-20', to: '2026-09-20' });
  });

  it('0인 날을 채우고 요청 수 = 다섯 칸의 합', () => {
    const { totals, daily } = aggregateVoiceStats([{ dayBucket: '2026-09-30', ok: 3, empty: 1, invalid: 2, failed: 1, busy: 1 }], '2026-09-29', '2026-10-01');
    expect(daily.map((d) => d.day)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(daily[1]).toEqual({ day: '2026-09-30', requested: 8, ok: 3, empty: 1, invalid: 2, failed: 1, busy: 1 });
    expect(daily[0].requested).toBe(0);
    expect(totals).toEqual({ requested: 8, ok: 3, empty: 1, invalid: 2, failed: 1, busy: 1 });
  });
});
