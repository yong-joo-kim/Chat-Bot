import { computeCustomerKeyHash, computeKeyFingerprint } from './customer-key';

const SECRET_A = Buffer.from('a'.repeat(32));
const SECRET_B = Buffer.from('b'.repeat(32));

describe('computeCustomerKeyHash(순수 함수, §6.4)', () => {
  it('같은 입력은 같은 해시를 만든다(결정적)', () => {
    const h1 = computeCustomerKeyHash(SECRET_A, 'SHOPMALL', 'member-1');
    const h2 = computeCustomerKeyHash(SECRET_A, 'SHOPMALL', 'member-1');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('식별 공간(REF)이 다르면 같은 sub라도 다른 해시다(AC-OC2-2)', () => {
    const h1 = computeCustomerKeyHash(SECRET_A, 'SHOPMALL', 'member-1');
    const h2 = computeCustomerKeyHash(SECRET_A, 'OTHERMALL', 'member-1');
    expect(h1).not.toBe(h2);
  });

  it('구분자 모호성 — "AB"+"C"와 "A"+"BC"가 섞이지 않는다', () => {
    const h1 = computeCustomerKeyHash(SECRET_A, 'AB', 'C');
    const h2 = computeCustomerKeyHash(SECRET_A, 'A', 'BC');
    expect(h1).not.toBe(h2);
  });

  it('비밀이 다르면 해시가 다르다(사전 대입 방지 근거)', () => {
    const h1 = computeCustomerKeyHash(SECRET_A, 'SHOPMALL', 'member-1');
    const h2 = computeCustomerKeyHash(SECRET_B, 'SHOPMALL', 'member-1');
    expect(h1).not.toBe(h2);
  });

  it('원 sub 값은 해시 문자열에 노출되지 않는다', () => {
    const sub = 'member-secret-1234';
    const hash = computeCustomerKeyHash(SECRET_A, 'SHOPMALL', sub);
    expect(hash).not.toContain(sub);
  });
});

describe('computeKeyFingerprint(순수 함수)', () => {
  it('8 hex 길이 · 비밀마다 다른 지문', () => {
    const f1 = computeKeyFingerprint(SECRET_A);
    const f2 = computeKeyFingerprint(SECRET_B);
    expect(f1).toHaveLength(8);
    expect(f1).not.toBe(f2);
  });
});
