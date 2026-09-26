import { computeSignature, verifySignature } from './signature';

describe('No.41 서명(§8.2)', () => {
  it('고정 벡터 — HMAC-SHA256(secret, "<t>.<body>")와 일치한다', () => {
    // node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('1700000000.{\"a\":1}').digest('hex'))"
    const expectedHex = require('node:crypto').createHmac('sha256', 'test-secret').update('1700000000.{"a":1}').digest('hex');
    const header = computeSignature('test-secret', 1700000000, '{"a":1}');
    expect(header).toBe(`t=1700000000,v1=${expectedHex}`);
  });

  it('검증 — 받는 쪽 예시 코드와 동일한 절차로 검증되면 true', () => {
    const now = new Date(1700000000 * 1000);
    const header = computeSignature('my-secret', 1700000000, 'raw-body');
    expect(verifySignature('my-secret', header, 'raw-body', now)).toBe(true);
  });

  it('본문이 바뀌면 검증 실패', () => {
    const now = new Date(1700000000 * 1000);
    const header = computeSignature('my-secret', 1700000000, 'raw-body');
    expect(verifySignature('my-secret', header, 'changed-body', now)).toBe(false);
  });

  it('재생 창(5분) 밖이면 검증 실패', () => {
    const header = computeSignature('my-secret', 1700000000, 'raw-body');
    const tooLate = new Date((1700000000 + 301) * 1000);
    expect(verifySignature('my-secret', header, 'raw-body', tooLate)).toBe(false);
  });

  it('형식이 다르면 검증 실패', () => {
    expect(verifySignature('s', 'not-a-valid-header', 'body', new Date())).toBe(false);
  });
});
