import { createHash } from 'node:crypto';

/**
 * ★ 감사 해시 체인 — 순수 함수(No.45, `data-governance-설계.md` §10.2). 정규 직렬화 v1은 **고정
 * 순서 배열** JSON이라 키 순서 문제가 없다. `rowHash` 접두가 방식을 표기한다(`s1:` = SHA-256 ·
 * `h1:<keyId>:` = HMAC-SHA256).
 */

export interface CanonicalRow {
  id: string;
  seq: number;
  createdAt: Date;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  chatbotId: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  summary: string | null;
  ip: string | null;
  userAgent: string | null;
}

export const GENESIS_HASH = 'g1:genesis';

export function canonicalizeV1(row: CanonicalRow): string {
  return JSON.stringify([
    'cb-audit-v1',
    row.id,
    row.seq,
    row.createdAt.toISOString(),
    row.actorId,
    row.actorEmail,
    row.actorRole,
    row.action,
    row.targetType,
    row.targetId,
    row.targetName,
    row.chatbotId,
    row.beforeValue,
    row.afterValue,
    row.summary,
    row.ip,
    row.userAgent,
  ]);
}

export type ChainMethod = 'SHA256' | 'HMAC';

export interface RowHashResult {
  rowHash: string;
  method: ChainMethod;
}

/** SHA-256 방식(키 없음) — `s1:<hex>`. */
export function computeSha256RowHash(prevHash: string, canonical: string): string {
  const digest = createHash('sha256').update(`${prevHash}\n${canonical}`, 'utf8').digest('hex');
  return `s1:${digest}`;
}

/** HMAC-SHA256 방식(키 있음) — `h1:<keyId>:<hex>`. `hmacHex`는 호출부(env-key.provider)가 계산한다. */
export function buildHmacRowHash(keyId: string, hmacHex: string): string {
  return `h1:${keyId}:${hmacHex}`;
}

/** `rowHash` 접두에서 방식·(HMAC이면) keyId를 판별한다. */
export function parseRowHashMethod(rowHash: string): { method: ChainMethod; keyId?: string } | null {
  if (rowHash.startsWith('s1:')) return { method: 'SHA256' };
  if (rowHash.startsWith('h1:')) {
    const rest = rowHash.slice('h1:'.length);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    return { method: 'HMAC', keyId: rest.slice(0, idx) };
  }
  return null;
}

/** `prevHash + '\n' + canonical`을 반환한다 — HMAC 서명 입력을 만드는 공용 헬퍼. */
export function hmacSignInput(prevHash: string, canonical: string): string {
  return `${prevHash}\n${canonical}`;
}
