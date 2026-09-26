import { buildHmacRowHash, canonicalizeV1, computeSha256RowHash, hmacSignInput, parseRowHashMethod } from './audit-chain';
import type { CanonicalRow } from './audit-chain';

const ROW: CanonicalRow = {
  id: 'row-1',
  seq: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  actorId: 'user-1',
  actorEmail: 'admin@example.com',
  actorRole: 'ADMIN',
  action: 'UPDATE',
  targetType: 'Chatbot',
  targetId: 'chatbot-1',
  targetName: '테스트 챗봇',
  chatbotId: 'chatbot-1',
  beforeValue: '{"name":"old"}',
  afterValue: '{"name":"new"}',
  summary: null,
  ip: '127.0.0.1',
  userAgent: 'jest',
};

describe('audit-logs/chain/audit-chain(No.45) — 순수 정규 직렬화·해시', () => {
  it('canonicalizeV1은 고정 순서 배열 JSON을 만든다(키 순서 문제 없음)', () => {
    const json = canonicalizeV1(ROW);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toBe('cb-audit-v1');
    expect(parsed[1]).toBe('row-1');
    expect(parsed[2]).toBe(1);
    expect(parsed[3]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('같은 입력은 항상 같은 직렬화 결과를 만든다(결정적)', () => {
    expect(canonicalizeV1(ROW)).toBe(canonicalizeV1({ ...ROW }));
  });

  it('필드가 하나라도 다르면 직렬화 결과가 달라진다', () => {
    expect(canonicalizeV1(ROW)).not.toBe(canonicalizeV1({ ...ROW, summary: '변경됨' }));
  });

  it('computeSha256RowHash — s1: 접두 · 결정적', () => {
    const canonical = canonicalizeV1(ROW);
    const hash = computeSha256RowHash('g1:genesis', canonical);
    expect(hash.startsWith('s1:')).toBe(true);
    expect(hash).toBe(computeSha256RowHash('g1:genesis', canonical));
  });

  it('prevHash가 다르면 rowHash도 달라진다(체인 연결)', () => {
    const canonical = canonicalizeV1(ROW);
    const a = computeSha256RowHash('g1:genesis', canonical);
    const b = computeSha256RowHash('s1:다른헤드', canonical);
    expect(a).not.toBe(b);
  });

  it('buildHmacRowHash — h1:<keyId>: 접두', () => {
    const hash = buildHmacRowHash('k1', 'deadbeef');
    expect(hash).toBe('h1:k1:deadbeef');
  });

  it('parseRowHashMethod — 접두로 방식·keyId를 판별한다', () => {
    expect(parseRowHashMethod('s1:abcdef')).toEqual({ method: 'SHA256' });
    expect(parseRowHashMethod('h1:k1:abcdef')).toEqual({ method: 'HMAC', keyId: 'k1' });
    expect(parseRowHashMethod('bogus')).toBeNull();
  });

  it('hmacSignInput은 prevHash와 정규 직렬화를 개행으로 묶는다', () => {
    const canonical = canonicalizeV1(ROW);
    expect(hmacSignInput('g1:genesis', canonical)).toBe(`g1:genesis\n${canonical}`);
  });
});
