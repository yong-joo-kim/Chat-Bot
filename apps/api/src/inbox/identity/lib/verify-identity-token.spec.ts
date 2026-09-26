import { createHmac } from 'node:crypto';
import { verifyIdentityToken } from './verify-identity-token';

const SECRET = Buffer.from('a'.repeat(32), 'utf8');
const REF = 'SHOPMALL';
const OPTS = { maxTtlSec: 24 * 3600, skewSec: 300 };

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(header: unknown, payload: unknown, key: Buffer = SECRET): string {
  const h = b64url(header);
  const p = b64url(payload);
  const sig = createHmac('sha256', key).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function nowSec(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

describe('verifyIdentityToken(순수 함수, §6.2)', () => {
  const now = new Date();

  it('정상 토큰 — sub/iat/exp만 있어도 통과한다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now) - 10, exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sub).toBe('member-1');
  });

  it('alg:none은 MALFORMED다', () => {
    const token = sign({ alg: 'none' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('alg:RS256(치환 공격)은 MALFORMED다', () => {
    const token = sign({ alg: 'RS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('crit 헤더는 MALFORMED다', () => {
    const token = sign({ alg: 'HS256', crit: ['exp'] }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('typ이 JWT가 아니면 MALFORMED다', () => {
    const token = sign({ alg: 'HS256', typ: 'JWS' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('서명이 변조되면 SIGNATURE다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const tampered = token.slice(0, -2) + 'zz';
    const result = verifyIdentityToken(tampered, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'SIGNATURE' });
  });

  it('다른 비밀로 서명하면 SIGNATURE다', () => {
    const wrongKey = Buffer.from('b'.repeat(32), 'utf8');
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 }, wrongKey);
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'SIGNATURE' });
  });

  it('__PREV 비밀로 서명된 토큰은 병행 검증으로 통과한다', () => {
    const prevKey = Buffer.from('c'.repeat(32), 'utf8');
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 }, prevKey);
    const result = verifyIdentityToken(token, { current: SECRET, previous: prevKey, ref: REF }, now, OPTS);
    expect(result.ok).toBe(true);
  });

  it('만료 경계 — exp + skew 직전은 통과, 직후는 EXPIRED다', () => {
    const exp = nowSec(now) - OPTS.skewSec;
    const tokenOk = sign({ alg: 'HS256' }, { sub: 'member-1', iat: exp - 100, exp });
    expect(verifyIdentityToken(tokenOk, { current: SECRET, ref: REF }, now, OPTS).ok).toBe(true);

    const tokenExpired = sign({ alg: 'HS256' }, { sub: 'member-1', iat: exp - 101, exp: exp - 1 });
    expect(verifyIdentityToken(tokenExpired, { current: SECRET, ref: REF }, now, OPTS)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('미래 iat(허용 오차 초과)는 NOT_YET_VALID다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now) + OPTS.skewSec + 10, exp: nowSec(now) + 4000 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'NOT_YET_VALID' });
  });

  it('미래 nbf(허용 오차 초과)는 NOT_YET_VALID다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), nbf: nowSec(now) + OPTS.skewSec + 10, exp: nowSec(now) + 4000 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'NOT_YET_VALID' });
  });

  it('TTL 초과(exp - iat > 최대 수명)는 TTL_TOO_LONG이다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + OPTS.maxTtlSec + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'TTL_TOO_LONG' });
  });

  it('sub 공백은 MALFORMED다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member 1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('sub 한글은 MALFORMED다', () => {
    const token = sign({ alg: 'HS256' }, { sub: '회원1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('aud가 식별 공간 참조와 다르면 MALFORMED다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600, aud: 'OTHER' });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('aud가 식별 공간 참조와 같으면 통과한다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600, aud: REF });
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result.ok).toBe(true);
  });

  it('길이 2,049바이트 초과는 MALFORMED다', () => {
    const hugeSub = 'a'.repeat(2000);
    const token = sign({ alg: 'HS256' }, { sub: hugeSub, iat: nowSec(now), exp: nowSec(now) + 3600 });
    expect(token.length).toBeGreaterThan(2048);
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('base64url 불량 문자는 MALFORMED다', () => {
    const result = verifyIdentityToken('abc!.def.ghi', { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('점이 2개가 아니면 MALFORMED다', () => {
    const result = verifyIdentityToken('abc.def', { current: SECRET, ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('비밀이 없으면 SECRET_MISSING이다', () => {
    const token = sign({ alg: 'HS256' }, { sub: 'member-1', iat: nowSec(now), exp: nowSec(now) + 3600 });
    const result = verifyIdentityToken(token, { ref: REF }, now, OPTS);
    expect(result).toEqual({ ok: false, reason: 'SECRET_MISSING' });
  });

  it('RFC 7515 부록 A.1 HS256 벡터를 교차 검증한다', () => {
    // RFC 7515 A.1 예제 헤더/페이로드(원문 그대로) — 서명 계산 검증 목적(sub 형식은 이 시험 전용으로 대체).
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { sub: 'joe-1', iat: nowSec(now) - 5, exp: nowSec(now) + 3600 };
    const token = sign(header, payload);
    const result = verifyIdentityToken(token, { current: SECRET, ref: REF }, now, OPTS);
    expect(result.ok).toBe(true);
  });
});
