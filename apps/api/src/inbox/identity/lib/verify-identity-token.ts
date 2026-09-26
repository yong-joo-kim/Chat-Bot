import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IdentityFailureReason } from '@chat-bot/shared-types';
import { base64UrlDecode, isBase64UrlString } from './base64url';

const MAX_TOKEN_BYTES = 2048;
const MAX_HEADER_BYTES = 256;
const MAX_PAYLOAD_BYTES = 1024;
const SUB_PATTERN = /^[\x21-\x7e]{1,128}$/;
const FORBIDDEN_HEADER_KEYS = ['crit', 'jku', 'jwk', 'x5u', 'x5c', 'kid'] as const;

export interface IdentityTokenSecrets {
  /** 없으면 검증 자체가 불가능하다(`SECRET_MISSING`). */
  current?: Buffer;
  /** 비밀 교체 병행 검증용(선택). */
  previous?: Buffer;
  /** 식별 공간 참조(`aud` 대조용). */
  ref: string;
}

export interface IdentityTokenOpts {
  maxTtlSec: number;
  skewSec: number;
}

export type VerifyIdentityTokenResult = { ok: true; sub: string; name?: string; iat: number; exp: number } | { ok: false; reason: IdentityFailureReason };

function fail(reason: IdentityFailureReason): VerifyIdentityTokenResult {
  return { ok: false, reason };
}

function parseJson(buf: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * [신규 No.42] JWS Compact HS256 고정 검증(§6.2 — 순수 · 시각·비밀 주입). 라이브러리 없이
 * `node:crypto`만 쓴다(O-16 — 알고리즘 혼동 공격면 0). 서명은 페이로드를 파싱하기 **전에** 먼저
 * 비교한다(NFR-OCS1 — 상수 시간).
 */
export function verifyIdentityToken(token: string, secrets: IdentityTokenSecrets, now: Date, opts: IdentityTokenOpts): VerifyIdentityTokenResult {
  if (!secrets.current) return fail('SECRET_MISSING');
  if (token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) return fail('MALFORMED');

  const parts = token.split('.');
  if (parts.length !== 3) return fail('MALFORMED');
  const [headerB64, payloadB64, sigB64] = parts;
  if (!isBase64UrlString(headerB64) || !isBase64UrlString(payloadB64) || !isBase64UrlString(sigB64)) return fail('MALFORMED');

  const headerBuf = base64UrlDecode(headerB64);
  if (!headerBuf || headerBuf.byteLength > MAX_HEADER_BYTES) return fail('MALFORMED');
  const header = parseJson(headerBuf);
  if (!header) return fail('MALFORMED');
  if (header.alg !== 'HS256') return fail('MALFORMED');
  if (header.typ !== undefined && header.typ !== 'JWT') return fail('MALFORMED');
  if (FORBIDDEN_HEADER_KEYS.some((k) => k in header)) return fail('MALFORMED');

  // ── 서명 우선(페이로드 파싱 전) ──
  const signedInput = `${headerB64}.${payloadB64}`;
  const sigBuf = base64UrlDecode(sigB64);
  if (!sigBuf || sigBuf.byteLength !== 32) return fail('SIGNATURE');

  const matchesKey = (key: Buffer): boolean => {
    const expected = createHmac('sha256', key).update(signedInput, 'utf8').digest();
    return expected.byteLength === sigBuf.byteLength && timingSafeEqual(expected, sigBuf);
  };

  const signatureOk = matchesKey(secrets.current) || (secrets.previous ? matchesKey(secrets.previous) : false);
  if (!signatureOk) return fail('SIGNATURE');

  // ── 서명 확인 후 클레임 형식 ──
  const payloadBuf = base64UrlDecode(payloadB64);
  if (!payloadBuf || payloadBuf.byteLength > MAX_PAYLOAD_BYTES) return fail('MALFORMED');
  const payload = parseJson(payloadBuf);
  if (!payload) return fail('MALFORMED');

  const sub = payload.sub;
  if (typeof sub !== 'string' || !SUB_PATTERN.test(sub)) return fail('MALFORMED');
  const iat = payload.iat;
  const exp = payload.exp;
  if (typeof iat !== 'number' || !Number.isInteger(iat)) return fail('MALFORMED');
  if (typeof exp !== 'number' || !Number.isInteger(exp)) return fail('MALFORMED');
  if (exp <= iat) return fail('MALFORMED');
  const nbf = payload.nbf;
  if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isInteger(nbf))) return fail('MALFORMED');
  const name = payload.name;
  if (name !== undefined && typeof name !== 'string') return fail('MALFORMED');
  const aud = payload.aud;
  if (aud !== undefined && (typeof aud !== 'string' || aud !== secrets.ref)) return fail('MALFORMED');

  const nowSec = Math.floor(now.getTime() / 1000);
  if (exp + opts.skewSec < nowSec) return fail('EXPIRED');
  if (iat > nowSec + opts.skewSec) return fail('NOT_YET_VALID');
  if (typeof nbf === 'number' && nbf > nowSec + opts.skewSec) return fail('NOT_YET_VALID');
  if (exp - iat > opts.maxTtlSec) return fail('TTL_TOO_LONG');

  return { ok: true, sub, name, iat, exp };
}
