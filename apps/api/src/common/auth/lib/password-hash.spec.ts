import { hashPassword, verifyPassword } from './password-hash';

describe('hashPassword / verifyPassword — ADR-0014 §7.2', () => {
  it('올바른 비밀번호는 검증에 성공한다', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword('correct-horse-battery-staple', hash)).resolves.toBe(true);
  });

  it('틀린 비밀번호는 검증에 실패한다', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('저장 형식에 scrypt 파라미터가 포함된다(재해싱 경로 확보)', async () => {
    const hash = await hashPassword('some-password');
    expect(hash).toMatch(/^scrypt\$N=32768,r=8,p=1\$/);
  });

  it('stored가 null이어도(계정 열거 방지) 예외 없이 false를 반환한다(FR-12-3)', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });

  it('손상된 저장 문자열은 예외 없이 false를 반환한다', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false);
  });

  it('같은 비밀번호라도 매번 다른 솔트로 해시가 달라진다', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
  });
});
