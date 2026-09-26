import { describe, expect, it } from 'vitest';
import { decodeIdentitySub } from './identity-token';

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: unknown, header: unknown = { alg: 'HS256', typ: 'JWT' }): string {
  return `${b64url(header)}.${b64url(payload)}.${b64url({ sig: 'x' })}`;
}

describe('decodeIdentitySub', () => {
  it('정상 토큰에서 sub를 디코드한다', () => {
    const token = makeToken({ sub: 'user-123', iat: 1, exp: 2 });
    expect(decodeIdentitySub(token)).toBe('user-123');
  });

  it('점 구분이 3개가 아니면 undefined', () => {
    expect(decodeIdentitySub('not-a-jwt')).toBeUndefined();
    expect(decodeIdentitySub('a.b')).toBeUndefined();
  });

  it('payload가 JSON이 아니면 undefined(예외 없음)', () => {
    expect(decodeIdentitySub('a.!!!notbase64!!!.c')).toBeUndefined();
  });

  it('sub 키가 없거나 문자열이 아니면 undefined', () => {
    expect(decodeIdentitySub(makeToken({ iat: 1 }))).toBeUndefined();
    expect(decodeIdentitySub(makeToken({ sub: 123 }))).toBeUndefined();
  });

  it('길이가 2048자를 초과하면 디코드를 시도하지 않고 undefined를 반환한다(코드 리뷰 R1 Low)', () => {
    const hugeToken = makeToken({ sub: 'user-123', iat: 1, exp: 2, padding: 'x'.repeat(3000) });
    expect(hugeToken.length).toBeGreaterThan(2048);
    expect(decodeIdentitySub(hugeToken)).toBeUndefined();
  });

  it('2048자 이하의 정상 토큰은 그대로 디코드된다(경계값)', () => {
    const token = makeToken({ sub: 'user-123', iat: 1, exp: 2 });
    expect(token.length).toBeLessThanOrEqual(2048);
    expect(decodeIdentitySub(token)).toBe('user-123');
  });
});
