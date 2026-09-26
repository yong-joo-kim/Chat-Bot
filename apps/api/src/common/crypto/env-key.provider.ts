import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildEnvelope, decryptWithKey, encryptWithKey, KEY_ID_PATTERN } from './field-envelope';

/**
 * ★ `DATA_ENCRYPTION_KEYS`·`AUDIT_CHAIN_KEY` 읽기 유일 파일(No.45, `data-governance-설계.md` §7.3 ·
 * ADR-0040 §1 · 정적 검사 G-4). 키 바이트를 반환하는 export는 없다 — 봉인·개봉·서명 함수만 밖으로 나간다.
 * 두 키는 zod 환경변수 스키마에 넣지 않는다(`ConfigService`에 값이 실리지 않게 — 레거시 API 시크릿
 * 리졸버 선례와 같은 규약). 값은 **지연 1회 파싱** 후 모듈 스코프에 메모한다(재기동 전에는 process.env가 바뀌어도 반영되지
 * 않는다 — 시험은 `resetKeyProvidersForTest()`로 재파싱을 강제한다).
 */

export class KeyringFormatError extends Error {}

interface KeyEntry {
  readonly id: string;
  readonly bytes: Buffer;
}

function parseKeyring(raw: string | undefined, label: string): KeyEntry[] {
  if (!raw || raw.trim() === '') return [];
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const entries: KeyEntry[] = [];
  for (const item of items) {
    const idx = item.indexOf(':');
    if (idx < 0) throw new KeyringFormatError(`${label} 항목 형식이 올바르지 않습니다("<id>:<base64>" 필요).`);
    const id = item.slice(0, idx);
    const b64 = item.slice(idx + 1);
    if (!KEY_ID_PATTERN.test(id)) throw new KeyringFormatError(`${label} 키 id 형식 오류: "${id}"(영소문자·숫자 1~8자).`);
    if (seen.has(id)) throw new KeyringFormatError(`${label} 키 id가 중복됩니다: "${id}".`);
    seen.add(id);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch {
      throw new KeyringFormatError(`${label} 키(${id})의 base64 디코딩에 실패했습니다.`);
    }
    if (bytes.length !== 32) {
      throw new KeyringFormatError(`${label} 키(${id}) 길이 오류 — 32바이트(AES-256)가 필요합니다.`);
    }
    entries.push({ id, bytes });
  }
  return entries;
}

export interface KeyProvider {
  writeKeyId(): string | null;
  hasKey(id: string): boolean;
  keyIds(): string[];
  /** AAD·평문 → 봉투 문자열(쓰기 키 사용). 쓰기 키가 없으면 예외. */
  aesGcmSeal(aad: string, plaintext: string): string;
  /** keyId·AAD·`iv‖ct‖tag` → 평문. 키 없음·태그 불일치·손상이면 예외. */
  aesGcmOpen(keyId: string, aad: string, payload: Buffer): string;
}

let fieldKeyring: KeyEntry[] | null = null;
let fieldKeyringParsed = false;

function getFieldKeyring(): KeyEntry[] {
  if (!fieldKeyringParsed) {
    fieldKeyring = parseKeyring(process.env.DATA_ENCRYPTION_KEYS, 'DATA_ENCRYPTION_KEYS');
    fieldKeyringParsed = true;
  }
  return fieldKeyring as KeyEntry[];
}

class EnvFieldKeyProvider implements KeyProvider {
  writeKeyId(): string | null {
    return getFieldKeyring()[0]?.id ?? null;
  }

  hasKey(id: string): boolean {
    return getFieldKeyring().some((k) => k.id === id);
  }

  keyIds(): string[] {
    return getFieldKeyring().map((k) => k.id);
  }

  aesGcmSeal(aad: string, plaintext: string): string {
    const entry = getFieldKeyring()[0];
    if (!entry) throw new Error('DATA_ENCRYPTION_KEYS가 설정되지 않았습니다.');
    const payload = encryptWithKey(entry.bytes, aad, plaintext);
    return buildEnvelope(entry.id, payload);
  }

  aesGcmOpen(keyId: string, aad: string, payload: Buffer): string {
    const entry = getFieldKeyring().find((k) => k.id === keyId);
    if (!entry) throw new Error(`키를 찾을 수 없습니다: ${keyId}`);
    return decryptWithKey(entry.bytes, aad, payload);
  }
}

const fieldKeyProviderInstance = new EnvFieldKeyProvider();

/** 1차 구현체 — KMS·HSM(2차)은 이 함수의 반환 구현체 교체가 유일한 지점이다. */
export function fieldKeyProvider(): KeyProvider {
  return fieldKeyProviderInstance;
}

// ── 감사 체인 서명 키(AUDIT_CHAIN_KEY) — 같은 키링 형식, 검증 전용 다수 허용 ──

let chainKeyring: KeyEntry[] | null = null;
let chainKeyringParsed = false;

function getChainKeyring(): KeyEntry[] {
  if (!chainKeyringParsed) {
    chainKeyring = parseKeyring(process.env.AUDIT_CHAIN_KEY, 'AUDIT_CHAIN_KEY');
    chainKeyringParsed = true;
  }
  return chainKeyring as KeyEntry[];
}

export interface AuditChainSigner {
  readonly keyId: string | null;
  sign(input: string): string;
  /** 알려진 키가 아니면 `null`(검증기가 `KEY_UNAVAILABLE`로 처리). */
  verify(keyId: string, input: string): string | null;
}

export function auditChainSigner(): AuditChainSigner {
  const keyring = getChainKeyring();
  const writeEntry = keyring[0] ?? null;
  return {
    keyId: writeEntry?.id ?? null,
    sign(input: string): string {
      if (!writeEntry) throw new Error('AUDIT_CHAIN_KEY가 설정되지 않았습니다.');
      return createHmac('sha256', writeEntry.bytes).update(input, 'utf8').digest('hex');
    },
    verify(keyId: string, input: string): string | null {
      const entry = keyring.find((k) => k.id === keyId);
      if (!entry) return null;
      return createHmac('sha256', entry.bytes).update(input, 'utf8').digest('hex');
    },
  };
}

/** 상수 시간 비교(타이밍 공격 방지) — 길이가 다르면 즉시 false. */
export function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 시험 전용 — 다음 호출에서 `process.env`를 다시 읽게 한다(함수명에 `ForTest`, 운영 코드 호출 0). */
export function resetKeyProvidersForTest(): void {
  fieldKeyring = null;
  fieldKeyringParsed = false;
  chainKeyring = null;
  chainKeyringParsed = false;
}
