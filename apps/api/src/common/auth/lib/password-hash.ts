import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * 비밀번호 해시 — Node 내장 `crypto.scrypt`(ADR-0014 §7.2). 네이티브 의존성(`bcrypt`/`argon2`)을
 * 도입하지 않는다. 순수 모듈(Nest·DB 무의존, NFR-M1).
 *
 * ⚠ `maxmem`을 반드시 명시한다 — scrypt 메모리 사용량은 `128 × N × r = 32MiB`인데 Node 기본
 * `maxmem`이 정확히 32MiB라 기본값으로는 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`가 발생한다.
 */

type ScryptFn = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const scryptAsync = promisify(scrypt) as unknown as ScryptFn;

const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
/** 32MiB(Node 기본값)로는 N=32768,r=8 조합에서 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`가 난다. */
const MAX_MEM = 64 * 1024 * 1024;

async function deriveKey(password: string, salt: Buffer, keylen: number, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return scryptAsync(password, salt, keylen, { ...params, maxmem: MAX_MEM });
}

/** `scrypt$N=32768,r=8,p=1$<saltB64url>$<hashB64url>` 형식으로 저장한다(향후 재해싱 경로, FR-12-4). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null;
  const params: Record<string, number> = {};
  for (const pair of parts[1].split(',')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined || Number.isNaN(Number(value))) return null;
    params[key] = Number(value);
  }
  if (!params.N || !params.r || !params.p) return null;
  try {
    return { N: params.N, r: params.r, p: params.p, salt: Buffer.from(parts[2], 'base64url'), hash: Buffer.from(parts[3], 'base64url') };
  } catch {
    return null;
  }
}

/**
 * 계정 열거 방지용 더미 해시(FR-12-3). 모듈 로드 시 1회만 생성한다 — 요청마다 새로 만들면
 * 오히려 소요시간이 늘어나 역방향 신호가 된다(ADR-0014 §7.2).
 */
const DUMMY_HASH_PROMISE: Promise<string> = hashPassword('dummy-password-for-constant-time-verification');

/**
 * `stored`가 없어도(이메일 미존재) 동일한 연산을 수행해 응답 시간을 맞춘다.
 * 이 경우 검증 결과는 항상 `false`다.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const target = stored ?? (await DUMMY_HASH_PROMISE);
  const parsed = parseStoredHash(target);
  if (!parsed) return false;

  const derived = await deriveKey(password, parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p });
  const matches = derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  return stored !== null && matches;
}
