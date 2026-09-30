import { checkReplacementText, prepareExpressions, validateRuleBody } from './rule-validate';

describe('prepareExpressions — 표현 정규화 기준 검사(설계서 §4.2 ②)', () => {
  it('정규화 뒤 2글자 미만은 TOO_SHORT로 거부한다(입력 위치 index 유지)', () => {
    const r = prepareExpressions(['자살', 'a', '  ', '죽고싶다'], 'CONTAINS');
    expect(r.expressions).toEqual(['자살', '죽고싶다']);
    expect(r.issues.map((i) => [i.index, i.code])).toEqual([
      [1, 'TOO_SHORT'],
      [2, 'TOO_SHORT'],
    ]);
  });

  it('정규화 기준(NFKC·소문자·공백 축약) 중복은 첫 등장만 남기고 제거 수를 센다', () => {
    const r = prepareExpressions(['Kill Myself', 'kill  myself', 'ＫＩＬＬ ＭＹＳＥＬＦ', '다른 표현'], 'CONTAINS');
    expect(r.expressions).toEqual(['Kill Myself', '다른 표현']);
    expect(r.removedDuplicates).toBe(2);
  });

  it('EXACT는 공백이 있는 여러 단어 표현을 거부한다(detect()는 토큰 집합 비교라 영원히 안 맞는다)', () => {
    const r = prepareExpressions(['한단어', '두 단어'], 'EXACT');
    expect(r.expressions).toEqual(['한단어']);
    expect(r.issues).toEqual([{ index: 1, code: 'EXACT_MULTI_TOKEN', expression: '두 단어' }]);
  });

  it('CONTAINS는 여러 단어 표현을 허용한다', () => {
    expect(prepareExpressions(['두 단어'], 'CONTAINS').issues).toEqual([]);
  });

  it('앞뒤 공백은 원문 저장 전에 제거한다', () => {
    expect(prepareExpressions(['  표현입니다  '], 'CONTAINS').expressions).toEqual(['표현입니다']);
  });
});

describe('checkReplacementText — 대체 문구 텍스트 검사(설계서 §4.2 ③)', () => {
  it.each([
    ['<b>굵게</b>', 'NOT_PLAIN_TEXT'],
    ['자세히는 http://example.com 참고', 'NOT_PLAIN_TEXT'],
    ['https://example.com', 'NOT_PLAIN_TEXT'],
    ['www.example.com 방문', 'NOT_PLAIN_TEXT'],
    ['javascript:alert(1)', 'NOT_PLAIN_TEXT'],
    ['1줄\n2줄\n3줄\n4줄\n5줄\n6줄', 'TOO_MANY_LINES'],
  ])('%j → %s', (text, code) => {
    expect(checkReplacementText(text)).toBe(code);
  });

  it('줄바꿈 5줄 이하의 글자만 있으면 통과한다', () => {
    expect(checkReplacementText('도움이 필요하시면\n전문 기관에 연락해 주세요.')).toBeNull();
    expect(checkReplacementText('1 < 2 그리고 3 > 2')).toBeNull();
  });
});

describe('validateRuleBody', () => {
  const base = { expressions: ['표현하나', '표현둘'], matchType: 'CONTAINS' as const, action: 'MONITOR' as const };

  it('MONITOR면 입력된 대체 문구는 버려 null로 저장한다', () => {
    const r = validateRuleBody({ ...base, replacementText: '무시될 문구' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.replacementText).toBeNull();
  });

  it('REPLACE의 대체 문구는 trim해서 저장한다', () => {
    const r = validateRuleBody({ ...base, action: 'REPLACE', replacementText: '  안전 문구입니다.  ' });
    expect(r.ok && r.value.replacementText).toBe('안전 문구입니다.');
  });

  it('표현 오류는 details[].field = expressions.<i> · 메시지 앞에 코드 토큰', () => {
    const r = validateRuleBody({ ...base, expressions: ['정상표현', 'x'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details[0].field).toBe('expressions.1');
      expect(r.details[0].message.startsWith('TOO_SHORT')).toBe(true);
    }
  });

  it('REPLACE 문구에 링크가 있으면 replacementText 필드에 NOT_PLAIN_TEXT', () => {
    const r = validateRuleBody({ ...base, action: 'REPLACE', replacementText: 'http://x.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details).toEqual([{ field: 'replacementText', message: expect.stringMatching(/^NOT_PLAIN_TEXT/) }]);
  });

  it('경계 길이 — 표현 50자 · 표현 100개 · 대체 문구 300자는 lib에서 통과한다(zod가 상한을 막는다)', () => {
    const fifty = '가'.repeat(50);
    const many = Array.from({ length: 100 }, (_, i) => `표현-${i}`);
    expect(validateRuleBody({ ...base, expressions: [fifty] }).ok).toBe(true);
    expect(validateRuleBody({ ...base, expressions: many }).ok).toBe(true);
    expect(validateRuleBody({ ...base, action: 'REPLACE', replacementText: '가'.repeat(300) }).ok).toBe(true);
  });
});
