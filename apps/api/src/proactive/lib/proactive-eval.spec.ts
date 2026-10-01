import {
  accumulateDwell,
  evaluateProactiveGate,
  matchesPathCondition,
  matchProactivePathPattern,
  normalizeProactivePath,
  selectDueRule,
} from '@chat-bot/shared-types';
import type { SelectableProactiveRule } from '@chat-bot/shared-types';

describe('normalizeProactivePath — AC-PA7-5 경계 · 연속 슬래시·끝 슬래시·디코드', () => {
  it.each([
    ['/order/123', '/order/123'],
    ['/order/123/', '/order/123'],
    ['/', '/'],
    ['', '/'],
    ['order/123', '/order/123'],
    ['/order//123', '/order/123'],
    ['/order///123////', '/order/123'],
    ['/한글/경로', '/한글/경로'],
    ['/%ED%95%9C%EA%B8%80', '/한글'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeProactivePath(input)).toBe(expected);
  });

  it('실패하는 percent-decoding은 원문 세그먼트를 그대로 둔다', () => {
    expect(normalizeProactivePath('/%zz')).toBe('/%zz');
  });

  it('1만 자 경로도 길이 상한(2048)으로 잘라 처리한다', () => {
    const huge = '/' + 'a'.repeat(10000);
    const result = normalizeProactivePath(huge);
    expect(result.length).toBeLessThanOrEqual(2049);
  });
});

describe('matchProactivePathPattern — 세그먼트 매칭(정규식 0, 선형 시간)', () => {
  it.each([
    ['/order/**', '/order/123', true],
    ['/order/**', '/order/123/detail', true],
    ['/order/**', '/order', true],
    ['/order/*', '/order/123', true],
    ['/order/*', '/order/123/detail', false],
    ['/order/complete', '/order/complete', true],
    ['/order/complete', '/order/Complete', false],
    ['/', '/', true],
    ['/', '/order', false],
    ['/a/**/b', '/a/x/y/b', true],
    ['/a/**/b', '/a/b', true],
    ['/a/**/b', '/a/x/y', false],
  ])('pattern=%s path=%s → %s', (pattern, path, expected) => {
    expect(matchProactivePathPattern(pattern, path)).toBe(expected);
  });

  it('패턴이 200자를 넘으면 항상 false를 반환한다(방어)', () => {
    const longPattern = '/' + 'a'.repeat(300);
    expect(matchProactivePathPattern(longPattern, '/a')).toBe(false);
  });

  it('AC-PA7-5 — 1만 자 경로 × 극단적 패턴을 1,000회 수행해도 선형 시간(10초 이내 — ReDoS 방어 확인용, 부하 편차 흡수 T-6) 안에 끝난다', () => {
    const maliciousPath = '/' + 'a/'.repeat(5000);
    const pattern = '/**';
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) {
      matchProactivePathPattern(pattern, maliciousPath);
    }
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(10000);
  });
});

describe('matchesPathCondition — include ∨ exclude', () => {
  it('include 중 하나라도 일치하고 exclude 전부 불일치해야 true', () => {
    expect(matchesPathCondition(['/order/**'], ['/order/complete'], '/order/123')).toBe(true);
    expect(matchesPathCondition(['/order/**'], ['/order/complete'], '/order/complete')).toBe(false);
    expect(matchesPathCondition(['/a/**', '/b/**'], [], '/b/1')).toBe(true);
    expect(matchesPathCondition(['/a/**'], [], '/b/1')).toBe(false);
  });
});

const BASE_RULE: SelectableProactiveRule = {
  id: 'rule-1',
  trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 30 },
  devices: ['DESKTOP'],
};

describe('selectDueRule — 우선순위·기기·닫음·페이지당 1번·showUntil', () => {
  it('조건을 만족하는 첫 규칙을 고른다(서버가 이미 position 순으로 정렬)', () => {
    const result = selectDueRule([BASE_RULE], { path: '/order/123', dwellMs: 30000, device: 'DESKTOP', nowMs: 0, closedRuleIds: [], firedOnPage: [] });
    expect(result?.id).toBe('rule-1');
  });

  it('체류가 모자라면 고르지 않는다', () => {
    const result = selectDueRule([BASE_RULE], { path: '/order/123', dwellMs: 29999, device: 'DESKTOP', nowMs: 0, closedRuleIds: [], firedOnPage: [] });
    expect(result).toBeUndefined();
  });

  it('기기가 다르면 고르지 않는다', () => {
    const result = selectDueRule([BASE_RULE], { path: '/order/123', dwellMs: 30000, device: 'MOBILE', nowMs: 0, closedRuleIds: [], firedOnPage: [] });
    expect(result).toBeUndefined();
  });

  it('닫은 규칙은 다시 고르지 않는다', () => {
    const result = selectDueRule([BASE_RULE], { path: '/order/123', dwellMs: 30000, device: 'DESKTOP', nowMs: 0, closedRuleIds: ['rule-1'], firedOnPage: [] });
    expect(result).toBeUndefined();
  });

  it('이 페이지에서 이미 표시 시도한 규칙은 다시 고르지 않는다(페이지당 1번)', () => {
    const result = selectDueRule([BASE_RULE], { path: '/order/123', dwellMs: 30000, device: 'DESKTOP', nowMs: 0, closedRuleIds: [], firedOnPage: ['rule-1'] });
    expect(result).toBeUndefined();
  });

  it('showUntil이 지났으면 고르지 않는다', () => {
    const rule: SelectableProactiveRule = { ...BASE_RULE, showUntil: 1000 };
    const result = selectDueRule([rule], { path: '/order/123', dwellMs: 30000, device: 'DESKTOP', nowMs: 1000, closedRuleIds: [], firedOnPage: [] });
    expect(result).toBeUndefined();
  });

  it('우선순위가 높은(배열 앞) 규칙 1개만 고른다', () => {
    const second: SelectableProactiveRule = { ...BASE_RULE, id: 'rule-2' };
    const result = selectDueRule([BASE_RULE, second], { path: '/order/123', dwellMs: 30000, device: 'DESKTOP', nowMs: 0, closedRuleIds: [], firedOnPage: [] });
    expect(result?.id).toBe('rule-1');
  });
});

describe('evaluateProactiveGate — 사유별 판정', () => {
  const caps = { maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300 };
  const baseRecord = { shownCount: 0, optedOut: false };
  const okInput = { nowMs: 100_000, caps, record: baseRecord, panelOpen: false, handoffConnected: false, launcherVisible: true, bubbleVisible: false };

  it('모든 조건을 만족하면 ok:true', () => {
    expect(evaluateProactiveGate(okInput)).toEqual({ ok: true });
  });

  it('끄기(optedOut) → OPTED_OUT · final:true', () => {
    const result = evaluateProactiveGate({ ...okInput, record: { ...baseRecord, optedOut: true } });
    expect(result).toEqual({ ok: false, reason: 'OPTED_OUT', final: true });
  });

  it('런처 숨김 → LAUNCHER_HIDDEN · final:true', () => {
    const result = evaluateProactiveGate({ ...okInput, launcherVisible: false });
    expect(result).toEqual({ ok: false, reason: 'LAUNCHER_HIDDEN', final: true });
  });

  it('세션 상한 도달 → CAP_REACHED · final:true', () => {
    const result = evaluateProactiveGate({ ...okInput, record: { ...baseRecord, shownCount: 1 } });
    expect(result).toEqual({ ok: false, reason: 'CAP_REACHED', final: true });
  });

  it('말풍선이 이미 보임 → BUBBLE_VISIBLE · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, bubbleVisible: true });
    expect(result).toEqual({ ok: false, reason: 'BUBBLE_VISIBLE', final: false });
  });

  it('상담 연결 중 → HANDOFF_CONNECTED · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, handoffConnected: true });
    expect(result).toEqual({ ok: false, reason: 'HANDOFF_CONNECTED', final: false });
  });

  it('패널 열림 → PANEL_OPEN · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, panelOpen: true });
    expect(result).toEqual({ ok: false, reason: 'PANEL_OPEN', final: false });
  });

  it('사용자 전송 뒤 조용한 시간 안 → QUIET_AFTER_SEND · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, record: { ...baseRecord, lastUserSendAtMs: 99_000 } });
    expect(result).toEqual({ ok: false, reason: 'QUIET_AFTER_SEND', final: false });
  });

  it('최소 간격 안 → INTERVAL · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, record: { ...baseRecord, lastShownAtMs: 99_000 } });
    expect(result).toEqual({ ok: false, reason: 'INTERVAL', final: false });
  });

  // ── Medium #3(코드 리뷰) — FR-PA3-9 · K-10: 휴대폰 가상 키보드(호스트 입력 포커스) 표시 미루기 ──
  it('휴대폰 + 호스트 입력 포커스 중 → HOST_INPUT_FOCUSED · final:false', () => {
    const result = evaluateProactiveGate({ ...okInput, device: 'MOBILE', hostInputFocused: true });
    expect(result).toEqual({ ok: false, reason: 'HOST_INPUT_FOCUSED', final: false });
  });

  it('데스크톱 + 호스트 입력 포커스 중이어도 영향 없다(데스크톱은 가상 키보드 없음)', () => {
    const result = evaluateProactiveGate({ ...okInput, device: 'DESKTOP', hostInputFocused: true });
    expect(result).toEqual({ ok: true });
  });

  it('휴대폰이라도 호스트 입력 포커스가 아니면(false) 영향 없다', () => {
    const result = evaluateProactiveGate({ ...okInput, device: 'MOBILE', hostInputFocused: false });
    expect(result).toEqual({ ok: true });
  });

  it('필드 미제공(기존 호출자) → 기존 동작과 동일하게 ok:true(하위 호환)', () => {
    const result = evaluateProactiveGate(okInput);
    expect(result).toEqual({ ok: true });
  });

  it('휴대폰 + 호스트 입력 포커스여도 패널이 열려 있으면 PANEL_OPEN이 먼저 막는다(우선순위)', () => {
    const result = evaluateProactiveGate({ ...okInput, panelOpen: true, device: 'MOBILE', hostInputFocused: true });
    expect(result).toEqual({ ok: false, reason: 'PANEL_OPEN', final: false });
  });
});

describe('accumulateDwell — 절전·스로틀 과대 산입 방지', () => {
  it('정상 간격은 그대로 누적된다', () => {
    expect(accumulateDwell(0, 0, 1000, 1000)).toBe(1000);
  });

  it('절전으로 벌어진 간격은 tickMs의 2배까지만 인정한다', () => {
    expect(accumulateDwell(0, 0, 600_000, 1000)).toBe(2000);
  });

  it('시계가 거꾸로 가면(음수 방지) 0을 더한다', () => {
    expect(accumulateDwell(5000, 10_000, 9_000, 1000)).toBe(5000);
  });
});
