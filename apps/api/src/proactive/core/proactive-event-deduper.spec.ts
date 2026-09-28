import { ProactiveEventDeduper } from './proactive-event-deduper';

describe('ProactiveEventDeduper — 메모리 중복 억제(FR-PA5-6)', () => {
  it('등록 전에는 중복이 아니다', () => {
    const deduper = new ProactiveEventDeduper();
    expect(deduper.seenBefore('session-1', 'rule-1', 'SHOWN', 0)).toBe(false);
  });

  it('등록 후 같은 (sessionId, ruleId, kind)는 중복으로 본다', () => {
    const deduper = new ProactiveEventDeduper();
    deduper.register('session-1', 'rule-1', 'SHOWN', 1000);
    expect(deduper.seenBefore('session-1', 'rule-1', 'SHOWN', 2000)).toBe(true);
  });

  it('kind가 다르면 별도로 센다', () => {
    const deduper = new ProactiveEventDeduper();
    deduper.register('session-1', 'rule-1', 'SHOWN', 1000);
    expect(deduper.seenBefore('session-1', 'rule-1', 'CLICKED', 1000)).toBe(false);
  });

  it('TTL(24시간)이 지나면 다시 허용한다', () => {
    const deduper = new ProactiveEventDeduper();
    deduper.register('session-1', 'rule-1', 'SHOWN', 0);
    const justBefore = 24 * 60 * 60 * 1000 - 1;
    const justAfter = 24 * 60 * 60 * 1000 + 1;
    expect(deduper.seenBefore('session-1', 'rule-1', 'SHOWN', justBefore)).toBe(true);
    expect(deduper.seenBefore('session-1', 'rule-1', 'SHOWN', justAfter)).toBe(false);
  });

  it('세션 id 원문을 내부에 두지 않는다(해시 키만 저장)', () => {
    const deduper = new ProactiveEventDeduper();
    deduper.register('super-secret-session-id', 'rule-1', 'SHOWN', 0);
    const internalKeys = [...(deduper as unknown as { seen: Map<string, number> }).seen.keys()];
    expect(internalKeys.some((k) => k.includes('super-secret-session-id'))).toBe(false);
  });

  it('상한(50,000)을 넘으면 가장 오래된 항목부터 제거한다', () => {
    const deduper = new ProactiveEventDeduper();
    for (let i = 0; i < 50_000; i += 1) {
      deduper.register(`session-${i}`, 'rule-1', 'SHOWN', 0);
    }
    expect(deduper.size()).toBe(50_000);
    expect(deduper.seenBefore('session-0', 'rule-1', 'SHOWN', 0)).toBe(true);

    deduper.register('session-overflow', 'rule-1', 'SHOWN', 0);
    expect(deduper.size()).toBe(50_000);
    // 가장 먼저 등록된 session-0이 밀려나 더 이상 중복으로 잡히지 않는다.
    expect(deduper.seenBefore('session-0', 'rule-1', 'SHOWN', 0)).toBe(false);
    expect(deduper.seenBefore('session-overflow', 'rule-1', 'SHOWN', 0)).toBe(true);
  });
});
