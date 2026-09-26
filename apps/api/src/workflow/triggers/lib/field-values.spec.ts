import { processFieldValue } from './field-values';

describe('No.41 필드 값 가공(§11.1)', () => {
  it('CONST는 마스킹하지 않는다', () => {
    const result = processFieldValue('a', '010-1234-5678', 'CONST', false);
    expect(result.value).toBe('010-1234-5678');
    expect(result.masked).toBe(false);
  });

  it('SLOT ∧ !allowRawPersonalData → maskPii 적용', () => {
    const result = processFieldValue('phone', '010-1234-5678', 'SLOT', false);
    expect(result.value).not.toBe('010-1234-5678');
    expect(result.masked).toBe(true);
  });

  it('SLOT ∧ allowRawPersonalData → 원문 유지', () => {
    const result = processFieldValue('phone', '010-1234-5678', 'SLOT', true);
    expect(result.value).toBe('010-1234-5678');
    expect(result.masked).toBe(false);
  });

  it('탭을 제외한 제어 문자를 제거한다', () => {
    const result = processFieldValue('a', 'line1\nline2\ttab\x00null', 'CONST', false);
    expect(result.value).toBe('line1line2\ttabnull');
  });

  it('500자를 초과하면 절단한다(코드포인트 기준)', () => {
    const long = 'a'.repeat(600);
    const result = processFieldValue('a', long, 'CONST', false);
    expect(Array.from(result.value).length).toBe(500);
  });
});
