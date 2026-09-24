import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** 256비트 난수 상담 토큰(NFR-CSS1, §6.1). DB에는 해시만 저장한다. */
export function generateHandoffToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashHandoffToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 상수 시간 비교(§6.1) — 길이가 다르면(변조 시도) 즉시 false, `timingSafeEqual`을 호출하지 않는다. */
export function verifyHandoffToken(token: string, tokenHash: string): boolean {
  const candidate = Buffer.from(hashHandoffToken(token), 'utf8');
  const expected = Buffer.from(tokenHash, 'utf8');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
