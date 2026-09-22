import { validatePasswordPolicy } from '@chat-bot/shared-types';

describe('validatePasswordPolicy — FR-12-12', () => {
  it('10자 미만이면 LENGTH 위반이다', () => {
    const result = validatePasswordPolicy('Aa1!');
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain('LENGTH');
  });

  it('영문/숫자/특수문자 중 2종 미만이면 CHAR_CLASSES 위반이다', () => {
    const result = validatePasswordPolicy('onlylettershere');
    expect(result.violations.map((v) => v.rule)).toContain('CHAR_CLASSES');
  });

  it('이메일 로컬파트를 포함하면 EMAIL_LOCALPART 위반이다', () => {
    const result = validatePasswordPolicy('admin1234!!', { email: 'admin@chat-bot.local' });
    expect(result.violations.map((v) => v.rule)).toContain('EMAIL_LOCALPART');
  });

  it('길이·문자종·이메일 조건을 모두 만족하면 통과한다', () => {
    const result = validatePasswordPolicy('Xk9!mZq2pL', { email: 'user@example.com' });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
