import { generateHandoffToken, hashHandoffToken, verifyHandoffToken } from './handoff-token';

describe('handoff-token', () => {
  it('토큰은 매번 다르고 base64url 형식이다', () => {
    const a = generateHandoffToken();
    const b = generateHandoffToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('같은 토큰은 같은 해시를 만든다', () => {
    const token = generateHandoffToken();
    expect(hashHandoffToken(token)).toBe(hashHandoffToken(token));
  });

  it('올바른 토큰은 검증을 통과한다', () => {
    const token = generateHandoffToken();
    const hash = hashHandoffToken(token);
    expect(verifyHandoffToken(token, hash)).toBe(true);
  });

  it('틀린 토큰은 검증에 실패한다', () => {
    const hash = hashHandoffToken(generateHandoffToken());
    expect(verifyHandoffToken(generateHandoffToken(), hash)).toBe(false);
  });

  it('길이가 다른 문자열도 안전하게 false를 반환한다(예외 없음)', () => {
    expect(verifyHandoffToken('short', 'also-not-matching')).toBe(false);
  });
});
