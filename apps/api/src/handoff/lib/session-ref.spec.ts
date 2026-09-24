import { computeSessionRef, assignAliases } from './session-ref';

describe('computeSessionRef', () => {
  it('같은 챗봇·세션이면 항상 같은 16자 hex를 반환한다', () => {
    const a = computeSessionRef('chatbot-1', 'session-1');
    const b = computeSessionRef('chatbot-1', 'session-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('챗봇이 다르면 같은 세션이라도 다른 값이다(교차 상관 불가)', () => {
    const a = computeSessionRef('chatbot-1', 'session-1');
    const b = computeSessionRef('chatbot-2', 'session-1');
    expect(a).not.toBe(b);
  });
});

describe('assignAliases', () => {
  it('충돌 없으면 앞 6자를 별칭으로 쓴다', () => {
    const refs = ['aaaaaaaa11111111', 'bbbbbbbb22222222'];
    const aliases = assignAliases(refs);
    expect(aliases.get(refs[0])).toBe('aaaaaa');
    expect(aliases.get(refs[1])).toBe('bbbbbb');
  });

  it('앞 6자가 충돌하면 나중 행만 8자로 늘린다(먼저 배정된 행은 6자 유지)', () => {
    const refs = ['aaaaaa1111111111', 'aaaaaa2222222222'];
    const aliases = assignAliases(refs);
    expect(aliases.get(refs[0])).toBe('aaaaaa');
    expect(aliases.get(refs[1])).toBe('aaaaaa22');
  });
});
