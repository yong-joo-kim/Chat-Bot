// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearIdentityToken, loadIdentityToken, saveIdentityToken } from './identity-storage';
import { getOrCreateSessionId } from './session';
import { saveHandoffToken, loadHandoffToken } from './handoff-storage';

describe('identity-storage — 별도 sessionStorage 키(cb.idt.{slug})', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('cb.idt.{slug} 키에 저장되고 cb.sid/cb.state/cb.handoff와 섞이지 않는다', () => {
    saveIdentityToken('bot-a', 'token-1');
    expect(window.sessionStorage.getItem('cb.idt.bot-a')).toBe('token-1');
    expect(loadIdentityToken('bot-a')).toBe('token-1');

    // 다른 저장소 키에 영향이 없어야 한다.
    const sid = getOrCreateSessionId('bot-a');
    expect(window.sessionStorage.getItem('cb.sid.bot-a')).toBe(sid);
    saveHandoffToken('bot-a', { token: 'h-1', cursor: 0 });
    expect(loadHandoffToken('bot-a')?.token).toBe('h-1');
    // 식별 토큰 삭제가 다른 키에 영향을 주지 않는다.
    clearIdentityToken('bot-a');
    expect(loadIdentityToken('bot-a')).toBeUndefined();
    expect(window.sessionStorage.getItem('cb.sid.bot-a')).toBe(sid);
    expect(loadHandoffToken('bot-a')?.token).toBe('h-1');
  });

  it('슬러그별로 독립된 저장소를 쓴다', () => {
    saveIdentityToken('bot-a', 'a-token');
    saveIdentityToken('bot-b', 'b-token');
    expect(loadIdentityToken('bot-a')).toBe('a-token');
    expect(loadIdentityToken('bot-b')).toBe('b-token');
  });
});
