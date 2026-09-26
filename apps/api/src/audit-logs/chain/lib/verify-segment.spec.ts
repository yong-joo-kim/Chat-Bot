import { canonicalizeV1, computeSha256RowHash, GENESIS_HASH } from '../audit-chain';
import { verifySegment } from './verify-segment';
import type { ChainRowForVerify } from './verify-segment';

function baseRow(seq: number, overrides: Partial<ChainRowForVerify> = {}): Omit<ChainRowForVerify, 'prevHash' | 'rowHash'> {
  return {
    id: `row-${seq}`,
    seq,
    createdAt: new Date(`2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`),
    actorId: 'user-1',
    actorEmail: 'admin@example.com',
    actorRole: 'ADMIN',
    action: 'UPDATE',
    targetType: 'Chatbot',
    targetId: `chatbot-${seq}`,
    targetName: null,
    chatbotId: null,
    beforeValue: null,
    afterValue: null,
    summary: null,
    ip: null,
    userAgent: null,
    ...overrides,
  };
}

/** SHA-256 체인 3행을 만든다(제네시스부터). */
function buildChain(n: number): ChainRowForVerify[] {
  const rows: ChainRowForVerify[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq += 1) {
    const partial = baseRow(seq);
    const canonical = canonicalizeV1({ ...partial });
    const rowHash = computeSha256RowHash(prevHash, canonical);
    rows.push({ ...partial, prevHash, rowHash });
    prevHash = rowHash;
  }
  return rows;
}

const noopVerifyHmac = () => null;

describe('audit-logs/chain/lib/verify-segment(No.45) — 순수 검증', () => {
  it('정상 체인은 OK를 반환하고 방식별 건수를 센다', () => {
    const rows = buildChain(5);
    const result = verifySegment(rows, GENESIS_HASH, noopVerifyHmac);
    expect(result.status).toBe('OK');
    expect(result.checkedRows).toBe(5);
    expect(result.methods.sha256).toBe(5);
    expect(result.lastSeq).toBe(5);
  });

  it('행 내용이 변조되면 HASH_MISMATCH와 첫 이상 seq를 보고한다', () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2], summary: '변조됨' }; // seq=3 내용만 바뀜(rowHash는 그대로 — 재계산 시 불일치)
    const result = verifySegment(rows, GENESIS_HASH, noopVerifyHmac);
    expect(result.status).toBe('HASH_MISMATCH');
    expect(result.firstBadSeq).toBe(3);
  });

  it('중간 행이 삭제되면 SEQ_GAP을 반환한다', () => {
    const rows = buildChain(5);
    rows.splice(2, 1); // seq=3 제거
    const result = verifySegment(rows, GENESIS_HASH, noopVerifyHmac);
    expect(result.status).toBe('SEQ_GAP');
    expect(result.gap).toEqual({ fromSeq: 2, toSeq: 4 });
  });

  it('시작 해시가 틀리면 첫 행에서 HASH_MISMATCH', () => {
    const rows = buildChain(3);
    const result = verifySegment(rows, 's1:엉뚱한시작해시', noopVerifyHmac);
    expect(result.status).toBe('HASH_MISMATCH');
    expect(result.firstBadSeq).toBe(1);
  });

  it('빈 배열은 OK(검증할 것이 없음)', () => {
    const result = verifySegment([], GENESIS_HASH, noopVerifyHmac);
    expect(result.status).toBe('OK');
    expect(result.checkedRows).toBe(0);
  });

  it('HMAC 키가 없으면 KEY_UNAVAILABLE(구조는 신뢰하되 내용 검증은 건너뜀)', () => {
    const partial = baseRow(1);
    const canonical = canonicalizeV1({ ...partial });
    const row: ChainRowForVerify = { ...partial, prevHash: GENESIS_HASH, rowHash: `h1:k1:${canonical.length.toString(16)}deadbeef` };
    const result = verifySegment([row], GENESIS_HASH, () => null);
    expect(result.status).toBe('KEY_UNAVAILABLE');
    expect(result.keyId).toBe('k1');
  });

  it('HMAC 키가 있으면 재계산해 검증한다(불일치 시 HASH_MISMATCH)', () => {
    const partial = baseRow(1);
    const canonical = canonicalizeV1({ ...partial });
    const row: ChainRowForVerify = { ...partial, prevHash: GENESIS_HASH, rowHash: 'h1:k1:correcthex' };
    const okResult = verifySegment([row], GENESIS_HASH, () => 'correcthex');
    expect(okResult.status).toBe('OK');
    expect(okResult.methods.hmac).toBe(1);

    const badResult = verifySegment([row], GENESIS_HASH, () => 'wronghex');
    expect(badResult.status).toBe('HASH_MISMATCH');
  });
});
