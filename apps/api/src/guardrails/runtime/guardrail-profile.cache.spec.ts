import { emptyProfile } from '../lib/compile-profile';
import { GuardrailProfileCache, RETRY_AFTER_FAILURE_MS } from './guardrail-profile.cache';

describe('GuardrailProfileCache — 3층 캐시(설계서 §4.4)', () => {
  let now = 1_000_000;
  const clock = () => now;
  beforeEach(() => {
    now = 1_000_000;
  });

  it('전역 색인 — TTL 안이면 fresh, 지나면 stale(값은 유지)', () => {
    const cache = new GuardrailProfileCache(60_000, clock);
    expect(cache.getIndex()).toBeNull();
    cache.setIndex(new Set(['a']));
    expect(cache.getIndex()).toEqual({ value: new Set(['a']), fresh: true });
    now += 60_000;
    expect(cache.getIndex()).toEqual({ value: new Set(['a']), fresh: false });
  });

  it('적재 실패 뒤에는 직전 값을 유지하고 5초 뒤 다시 시도하도록 당겨 둔다', () => {
    const cache = new GuardrailProfileCache(60_000, clock);
    cache.setIndex(new Set(['a']));
    now += 60_000;
    cache.deferIndexRetry();
    expect(cache.getIndex()?.fresh).toBe(true);
    now += RETRY_AFTER_FAILURE_MS;
    expect(cache.getIndex()?.fresh).toBe(false);
  });

  it('규칙 쓰기는 전역 색인과 그 챗봇 프로필을 즉시 무효화하고 다른 챗봇·설정은 건드리지 않는다', () => {
    const cache = new GuardrailProfileCache(60_000, clock);
    cache.setIndex(new Set(['a']));
    cache.setProfile('a', emptyProfile());
    cache.setProfile('b', emptyProfile());
    cache.setSetting('a', { kinds: ['RRN'], preserveDates: true, isDefault: false });
    cache.invalidateRules('a');
    expect(cache.getIndex()).toBeNull();
    expect(cache.getProfile('a')).toBeNull();
    expect(cache.getProfile('b')).not.toBeNull();
    expect(cache.getSetting('a')).not.toBeNull();
  });

  it('설정 저장은 설정 슬롯만 무효화한다', () => {
    const cache = new GuardrailProfileCache(60_000, clock);
    cache.setProfile('a', emptyProfile());
    cache.setSetting('a', { kinds: [], preserveDates: false, isDefault: false });
    cache.invalidateSetting('a');
    expect(cache.getSetting('a')).toBeNull();
    expect(cache.getProfile('a')).not.toBeNull();
  });

  it('상한 초과 시 가장 오래 적재된 항목부터 제거한다(FIFO)', () => {
    const cache = new GuardrailProfileCache(60_000, clock, 3);
    for (const id of ['a', 'b', 'c', 'd']) cache.setProfile(id, emptyProfile());
    expect(cache.getProfile('a')).toBeNull();
    expect(cache.size().profiles).toBe(3);
    expect(cache.getProfile('d')).not.toBeNull();
  });
});
