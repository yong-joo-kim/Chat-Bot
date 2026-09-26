import { createHmac } from 'node:crypto';

/**
 * [신규 No.41] 서명 형식(§8.2) — 순수. `X-Chatbot-Signature: t=<unix초>,v1=<hex64>`.
 * `signedPayload = "<t>." + <raw body>`(UTF-8) · HMAC-SHA256.
 */
export function computeSignature(secret: string, unixSeconds: number, rawBody: string): string {
  const signedPayload = `${unixSeconds}.${rawBody}`;
  const hex = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${unixSeconds},v1=${hex}`;
}

export function verifySignature(secret: string, header: string, rawBody: string, now: Date, toleranceSeconds = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const t = Number(m[1]);
  const v1 = m[2];
  if (Math.abs(Math.round(now.getTime() / 1000) - t) > toleranceSeconds) return false;
  const expected = computeSignature(secret, t, rawBody);
  const expectedV1 = expected.split('v1=')[1];
  return timingSafeEqualHex(expectedV1, v1);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
