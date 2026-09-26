import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * ★ 필드 암호화 봉투 — 순수(키·AAD 주입, No.45 `data-governance-설계.md` §7.2). 형식은
 * `enc:v1:<keyId>:<base64(iv‖ciphertext‖tag)>`(AES-256-GCM · IV 96비트 무작위 · 태그 128비트).
 * `enc:` 접두가 없으면 평문(이행 기간 겸용 읽기).
 */

export const ENVELOPE_PREFIX = 'enc:v1:';
export const KEY_ID_PATTERN = /^[a-z0-9]{1,8}$/;

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export function isEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

export interface ParsedEnvelope {
  readonly keyId: string;
  readonly payload: Buffer;
}

/** `null` = 이 값은 봉투가 아니다(평문 또는 형식 불일치 — 평문으로 취급한다). */
export function parseEnvelope(value: string): ParsedEnvelope | null {
  if (!value.startsWith(ENVELOPE_PREFIX)) return null;
  const rest = value.slice(ENVELOPE_PREFIX.length);
  const sepIdx = rest.indexOf(':');
  if (sepIdx < 0) return null;
  const keyId = rest.slice(0, sepIdx);
  const b64 = rest.slice(sepIdx + 1);
  if (!KEY_ID_PATTERN.test(keyId) || b64.length === 0) return null;
  try {
    const payload = Buffer.from(b64, 'base64');
    if (payload.length < IV_LENGTH + TAG_LENGTH) return null;
    return { keyId, payload };
  } catch {
    return null;
  }
}

export function buildEnvelope(keyId: string, payload: Buffer): string {
  return `${ENVELOPE_PREFIX}${keyId}:${payload.toString('base64')}`;
}

/** `iv‖ciphertext‖tag` 바이트를 만든다(봉투 접두는 붙이지 않는다 — `buildEnvelope()`가 담당). */
export function encryptWithKey(keyBytes: Buffer, aad: string, plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBytes, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

/** `iv‖ciphertext‖tag` 페이로드를 개봉한다. 키 불일치·AAD 불일치·손상 시 예외를 던진다. */
export function decryptWithKey(keyBytes: Buffer, aad: string, payload: Buffer): string {
  if (payload.length < IV_LENGTH + TAG_LENGTH) throw new Error('INVALID_PAYLOAD_LENGTH');
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, keyBytes, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
