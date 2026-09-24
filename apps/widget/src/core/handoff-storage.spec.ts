// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { clearHandoffToken, loadHandoffToken, saveHandoffToken } from './handoff-storage';
import { loadConversationState, saveConversationState } from './session';

const SLUG = 'order-bot';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('widget core/handoff-storage — 상담 토큰 보관(P-5 · ADR-0036 §6.1)', () => {
  it('저장한 값을 그대로 읽는다', () => {
    saveHandoffToken(SLUG, { token: 'tok-1', cursor: 3 });
    expect(loadHandoffToken(SLUG)).toEqual({ token: 'tok-1', cursor: 3 });
  });

  it('저장 전에는 undefined다', () => {
    expect(loadHandoffToken(SLUG)).toBeUndefined();
  });

  it('삭제하면 다시 undefined가 된다', () => {
    saveHandoffToken(SLUG, { token: 'tok-1', cursor: 3 });
    clearHandoffToken(SLUG);
    expect(loadHandoffToken(SLUG)).toBeUndefined();
  });

  it('슬러그별로 분리된다', () => {
    saveHandoffToken('bot-a', { token: 'tok-a', cursor: 1 });
    saveHandoffToken('bot-b', { token: 'tok-b', cursor: 2 });
    expect(loadHandoffToken('bot-a')).toEqual({ token: 'tok-a', cursor: 1 });
    expect(loadHandoffToken('bot-b')).toEqual({ token: 'tok-b', cursor: 2 });
  });

  it('sessionStorage에 봉투(cb.state.*)와 별도 키로 저장된다 — 봉투에 토큰이 섞이지 않는다', () => {
    saveHandoffToken(SLUG, { token: 'super-secret-token', cursor: 7 });
    saveConversationState(SLUG, { version: 1, contextSession: null } as never);

    // 실제 sessionStorage 키가 분리돼 있어야 한다(ADR-0009 §3 — 토큰은 신원 값이라 봉투 밖).
    expect(window.sessionStorage.getItem(`cb.handoff.${SLUG}`)).toContain('super-secret-token');
    expect(window.sessionStorage.getItem(`cb.state.${SLUG}`)).not.toContain('super-secret-token');

    // 봉투 로더로 읽은 값에도 토큰 필드가 없다.
    const state = loadConversationState(SLUG);
    expect(JSON.stringify(state)).not.toContain('super-secret-token');
  });

  it('형식이 깨진 값은 undefined로 처리한다', () => {
    window.sessionStorage.setItem(`cb.handoff.${SLUG}`, 'not-json');
    expect(loadHandoffToken(SLUG)).toBeUndefined();
    window.sessionStorage.setItem(`cb.handoff.${SLUG}`, JSON.stringify({ token: 'x' })); // cursor 없음
    expect(loadHandoffToken(SLUG)).toBeUndefined();
  });
});
