import { canonicalizeV1, computeSha256RowHash, hmacSignInput, parseRowHashMethod } from '../audit-chain';
import type { CanonicalRow } from '../audit-chain';

export interface ChainRowForVerify extends CanonicalRow {
  prevHash: string | null;
  rowHash: string | null;
}

export type VerifySegmentStatus = 'OK' | 'HASH_MISMATCH' | 'SEQ_GAP' | 'KEY_UNAVAILABLE';

export interface VerifySegmentResult {
  status: VerifySegmentStatus;
  firstBadSeq?: number;
  gap?: { fromSeq: number; toSeq: number };
  keyId?: string;
  checkedRows: number;
  methods: { sha256: number; hmac: number };
  lastSeq: number | null;
  lastHash: string | null;
}

/**
 * ★ 순수 — 행 배열(오름차순 · seq 연속 가정 전) + 시작 해시 → 결과 코드(No.45 §10.6). `verifyHmac`은
 * `keyId`가 알려지지 않으면 `null`을 반환해야 한다(호출부가 `env-key.provider.ts`의 `auditChainSigner()`
 * 를 주입).
 */
export function verifySegment(
  rows: readonly ChainRowForVerify[],
  startHash: string,
  verifyHmac: (keyId: string, input: string) => string | null,
): VerifySegmentResult {
  let prevHash = startHash;
  let prevSeq: number | null = null;
  let checkedRows = 0;
  let sha256Count = 0;
  let hmacCount = 0;
  let keyUnavailableId: string | undefined;

  for (const row of rows) {
    if (prevSeq !== null && row.seq !== prevSeq + 1) {
      return { status: 'SEQ_GAP', gap: { fromSeq: prevSeq, toSeq: row.seq }, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
    }
    if (row.prevHash !== prevHash || !row.rowHash) {
      return { status: 'HASH_MISMATCH', firstBadSeq: row.seq, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
    }

    const parsed = parseRowHashMethod(row.rowHash);
    const canonical = canonicalizeV1(row);

    if (!parsed) {
      return { status: 'HASH_MISMATCH', firstBadSeq: row.seq, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
    }

    if (parsed.method === 'SHA256') {
      const expected = computeSha256RowHash(prevHash, canonical);
      if (expected !== row.rowHash) {
        return { status: 'HASH_MISMATCH', firstBadSeq: row.seq, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
      }
      sha256Count += 1;
    } else {
      const keyId = parsed.keyId as string;
      const hmacHex = verifyHmac(keyId, hmacSignInput(prevHash, canonical));
      if (hmacHex === null) {
        // 키가 없어 이 행의 내용은 검증할 수 없다 — 구조(연속성·prevHash 연결)만 신뢰하고 전진한다.
        keyUnavailableId = keyUnavailableId ?? keyId;
      } else {
        const expected = `h1:${keyId}:${hmacHex}`;
        if (expected !== row.rowHash) {
          return { status: 'HASH_MISMATCH', firstBadSeq: row.seq, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
        }
      }
      hmacCount += 1;
    }

    prevHash = row.rowHash;
    prevSeq = row.seq;
    checkedRows += 1;
  }

  if (keyUnavailableId) {
    return { status: 'KEY_UNAVAILABLE', keyId: keyUnavailableId, checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
  }
  return { status: 'OK', checkedRows, methods: { sha256: sha256Count, hmac: hmacCount }, lastSeq: prevSeq, lastHash: prevHash };
}
