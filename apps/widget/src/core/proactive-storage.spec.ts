// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { loadProactiveRecord, recordClosed, recordOptedOut, recordShown, recordUserSend } from './proactive-storage';

const SLUG = 'order-bot';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('core/proactive-storage — sessionStorage 전용 노출·닫음 기록(§6.6)', () => {
  it('초기값은 0표시·빈 닫힘목록·끄기 없음이다', () => {
    const rec = loadProactiveRecord(SLUG);
    expect(rec).toEqual({ shownCount: 0, closedRuleIds: [], optedOut: false });
  });

  it('recordShown은 shownCount를 늘리고 lastShownAtMs를 기록한다', () => {
    const rec = recordShown(SLUG, 1000);
    expect(rec.shownCount).toBe(1);
    expect(rec.lastShownAtMs).toBe(1000);
    expect(loadProactiveRecord(SLUG).shownCount).toBe(1);
  });

  it('recordClosed은 같은 규칙을 중복으로 넣지 않는다', () => {
    recordClosed(SLUG, 'rule-1');
    const rec = recordClosed(SLUG, 'rule-1');
    expect(rec.closedRuleIds).toEqual(['rule-1']);
  });

  it('recordOptedOut은 optedOut을 true로 저장한다(다시 불러도 유지)', () => {
    recordOptedOut(SLUG);
    expect(loadProactiveRecord(SLUG).optedOut).toBe(true);
  });

  it('recordUserSend는 lastUserSendAtMs를 저장한다', () => {
    recordUserSend(SLUG, 5000);
    expect(loadProactiveRecord(SLUG).lastUserSendAtMs).toBe(5000);
  });

  it('저장된 값의 형식이 불량(v 다름)이면 초기값으로 취급한다', () => {
    window.sessionStorage.setItem('cb.pa.order-bot', JSON.stringify({ v: 2, shownCount: 99 }));
    expect(loadProactiveRecord(SLUG)).toEqual({ shownCount: 0, closedRuleIds: [], optedOut: false });
  });

  it('저장된 값이 JSON이 아니면 초기값으로 취급한다', () => {
    window.sessionStorage.setItem('cb.pa.order-bot', 'not-json');
    expect(loadProactiveRecord(SLUG)).toEqual({ shownCount: 0, closedRuleIds: [], optedOut: false });
  });

  it('다른 슬러그는 서로 다른 키를 쓴다(간섭 없음)', () => {
    recordShown('bot-a', 1);
    expect(loadProactiveRecord('bot-b').shownCount).toBe(0);
  });

  it('localStorage·쿠키는 전혀 쓰지 않는다(sessionStorage에만 남는다)', () => {
    recordShown(SLUG, 1);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(window.sessionStorage.getItem('cb.pa.order-bot')).not.toBeNull();
  });
});
