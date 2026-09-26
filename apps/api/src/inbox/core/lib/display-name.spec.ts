import { prepareDisplayName, sanitizeDisplayName } from './display-name';

describe('sanitizeDisplayName(순수 함수, §6.4)', () => {
  it('제어 문자를 제거한다', () => {
    expect(sanitizeDisplayName('홍길동\u0000\u0007')).toBe('홍길동');
  });

  it('양방향 제어 문자(RLO 등)를 제거한다(EX-OC-5)', () => {
    expect(sanitizeDisplayName('‮홍길동‬')).toBe('홍길동');
  });

  it('40 코드포인트를 초과하면 절단한다', () => {
    const long = 'a'.repeat(50);
    expect(sanitizeDisplayName(long).length).toBe(40);
  });

  it('앞뒤 공백을 정리한다', () => {
    expect(sanitizeDisplayName('  홍길동  ')).toBe('홍길동');
  });
});

describe('prepareDisplayName(§6.4 · 코드리뷰 R1 M-2 — sanitize → 금지어 마스킹 → maskForInbox 순서)', () => {
  function fakeBannedWordFilter(replace: (text: string) => string) {
    return { maskPlainText: jest.fn(async (text: string) => replace(text)) };
  }

  it('제어·양방향 제어 문자를 먼저 제거한 뒤 금지어 마스킹을 적용한다', async () => {
    const filter = fakeBannedWordFilter((text) => text.replace('바보', '***'));
    const result = await prepareDisplayName('홍\u0000길동바보‮X‬', filter);
    expect(result).toBe('홍길동***X');
    // 정리된(제어 문자 제거된) 문자열이 금지어 필터에 전달됐는지 확인 — 순서 보장.
    expect(filter.maskPlainText).toHaveBeenCalledWith('홍길동바보X');
  });

  it('sanitize 결과가 빈 문자열이면 금지어 필터를 호출하지 않고 undefined를 반환한다', async () => {
    const filter = fakeBannedWordFilter((text) => text);
    const result = await prepareDisplayName('\u0000\u0007', filter);
    expect(result).toBeUndefined();
    expect(filter.maskPlainText).not.toHaveBeenCalled();
  });

  it('금지어 마스킹 다음 단계로 PII 마스킹(maskForInbox)까지 적용된 결과를 돌려준다', async () => {
    const filter = fakeBannedWordFilter((text) => text);
    const result = await prepareDisplayName('제 번호는 010-1234-5678', filter);
    expect(result).toBeDefined();
    expect(result).not.toContain('010-1234-5678');
  });
});
