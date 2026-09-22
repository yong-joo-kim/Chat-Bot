import { maskPii } from './index';

describe('maskPii — FR-11-23, ADR-0013', () => {
  it('주민등록번호는 전량 마스킹된다', () => {
    const result = maskPii('제 주민번호는 901231-1234567 입니다');
    expect(result.maskedText).toContain('[주민등록번호]');
    expect(result.maskedText).not.toContain('901231');
    expect(result.counts.rrn).toBe(1);
  });

  it('카드번호는 전량 마스킹된다', () => {
    const result = maskPii('카드번호 1234-5678-9012-3456 로 결제했어요');
    expect(result.maskedText).toContain('[카드번호]');
    expect(result.maskedText).not.toContain('1234-5678');
    expect(result.counts.card).toBe(1);
  });

  it('전화번호는 부분 마스킹된다(FR-11-23 예시: 010-****-5678)', () => {
    const result = maskPii('연락처는 010-1234-5678 입니다');
    expect(result.maskedText).toContain('010-****-5678');
    expect(result.counts.phone).toBe(1);
  });

  it('이메일은 부분 마스킹된다(FR-11-23 예시: a***@example.com)', () => {
    const result = maskPii('제 이메일은 abcd@example.com 입니다');
    expect(result.maskedText).toContain('a***@example.com');
    expect(result.counts.email).toBe(1);
  });

  it('계좌번호로 보이는 다중 구분 숫자열은 전량 마스킹된다', () => {
    const result = maskPii('계좌번호 110-234-567890 로 입금해 주세요');
    expect(result.maskedText).toContain('[계좌번호]');
    expect(result.counts.account).toBe(1);
  });

  it('PII가 없는 일반 문장은 변경되지 않는다', () => {
    const result = maskPii('배송 조회하고 싶어요');
    expect(result.maskedText).toBe('배송 조회하고 싶어요');
    expect(Object.values(result.counts).every((c) => c === 0)).toBe(true);
  });

  it('빈 문자열은 그대로 반환된다', () => {
    const result = maskPii('');
    expect(result.maskedText).toBe('');
  });

  it('여러 종류가 한 문장에 섞여 있어도 각각 마스킹된다', () => {
    const result = maskPii('전화 010-1234-5678, 이메일 test@a.com 로 연락 주세요');
    expect(result.maskedText).toContain('010-****-5678');
    expect(result.maskedText).toContain('t***@a.com');
  });
});
