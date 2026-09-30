import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { buildRuleBody, EMPTY_RULE_FORM, mapRuleServerError, validateExpressionOnAdd, validateRuleForm, type RuleFormValues } from './ruleForm';

const valid: RuleFormValues = {
  ...EMPTY_RULE_FORM,
  name: '투자 권유',
  category: 'FINANCIAL_ADVICE',
  appliesTo: 'OUTBOUND',
  expressions: ['수익 보장', '원금 보장'],
};

describe('규칙 폼 사전 검사(제출 전, 서버를 부르지 않는다)', () => {
  it('새 규칙 기본값은 동작 "기록만"·찾는 방식 "포함"·저장하면 바로 사용이고 분류·적용 위치는 미선택이다', () => {
    expect(EMPTY_RULE_FORM).toMatchObject({ action: 'MONITOR', matchType: 'CONTAINS', enabled: true, category: '', appliesTo: '' });
  });

  it('빈 폼은 이름·분류·적용 위치·표현 오류를 낸다', () => {
    const { errors } = validateRuleForm(EMPTY_RULE_FORM);
    expect(Object.keys(errors).sort()).toEqual(['appliesTo', 'category', 'expressions', 'name']);
  });

  it('올바른 폼은 오류가 없다', () => {
    expect(validateRuleForm(valid).errors).toEqual({});
  });

  it('"AI로 보내지 않음"은 사용자 질문일 때만 가능하다', () => {
    expect(validateRuleForm({ ...valid, action: 'NO_RAG', appliesTo: 'BOTH' }).errors.action).toContain('사용자 질문');
    expect(validateRuleForm({ ...valid, action: 'NO_RAG', appliesTo: 'INBOUND' }).errors.action).toBeUndefined();
  });

  it('대체 동작은 대체 문구가 필수이고 링크·HTML·6줄 이상은 거부한다', () => {
    expect(validateRuleForm({ ...valid, action: 'REPLACE', replacementText: '' }).errors.replacementText).toContain('대체 문구');
    expect(validateRuleForm({ ...valid, action: 'REPLACE', replacementText: '<b>안내</b>' }).errors.replacementText).toContain('HTML');
    expect(validateRuleForm({ ...valid, action: 'REPLACE', replacementText: 'http://x.co 안내' }).errors.replacementText).toContain('링크');
    expect(validateRuleForm({ ...valid, action: 'REPLACE', replacementText: '1\n2\n3\n4\n5\n6' }).errors.replacementText).toContain('5줄');
    expect(validateRuleForm({ ...valid, action: 'REPLACE', replacementText: '안전 문구입니다.' }).errors.replacementText).toBeUndefined();
  });

  it('"단어 일치"는 띄어쓰기 있는 표현을 거부하고 해당 표현을 표시한다', () => {
    const result = validateRuleForm({ ...valid, matchType: 'EXACT' });
    expect(result.errors.expressions).toContain('띄어쓰기 없는 한 단어');
    expect(result.invalidExpressions).toEqual(['수익 보장', '원금 보장']);
  });

  it('표현 추가 검증: 정규화 2글자 미만·50자 초과', () => {
    expect(validateExpressionOnAdd('가')).toContain('너무 짧습니다');
    expect(validateExpressionOnAdd(' A ')).toContain('너무 짧습니다');
    expect(validateExpressionOnAdd('가나')).toBeUndefined();
    expect(validateExpressionOnAdd('가'.repeat(51))).toContain('50자');
  });

  it('buildRuleBody: 완성된 폼만 본문이 되고 미완성은 null(저장 전 시험 불가)', () => {
    expect(buildRuleBody(EMPTY_RULE_FORM)).toBeNull();
    const body = buildRuleBody(valid);
    expect(body).toMatchObject({ name: '투자 권유', category: 'FINANCIAL_ADVICE', appliesTo: 'OUTBOUND', action: 'MONITOR', enabled: true });
    // 대체가 아니면 대체 문구는 보내지 않는다.
    expect(buildRuleBody({ ...valid, replacementText: '남은 값' })?.replacementText ?? null).toBeNull();
  });
});

describe('서버 오류 → 필드 매핑(§5.4)', () => {
  const err = (status: number, code: string, details?: Array<{ field: string; message: string }>): ApiError => new ApiError(status, '서버 문구', code as never, details);

  it('VALIDATION_FAILED: 코드 토큰으로 필드를 가른다', () => {
    const r = mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'expressions.1', message: 'TOO_SHORT: 표현은 2글자 이상' }]), ['수익 보장', '가']);
    expect(r.errors.expressions).toContain('‘가’은 너무 짧습니다');
    expect(r.invalidExpressions).toEqual(['가']);

    const exact = mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'expressions.0', message: 'EXACT_MULTI_TOKEN: x' }]), ['수익 보장']);
    expect(exact.errors.expressions).toContain('띄어쓰기 없는 한 단어');

    expect(mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'replacementText', message: 'NOT_PLAIN_TEXT: x' }]), []).errors.replacementText).toContain('HTML');
    expect(mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'replacementText', message: 'TOO_MANY_LINES: x' }]), []).errors.replacementText).toContain('5줄');
    expect(mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'action', message: '...' }]), []).errors.action).toContain('사용자 질문');
    expect(mapRuleServerError(err(400, 'VALIDATION_FAILED', [{ field: 'name', message: '...' }]), []).errors.name).toContain('1~50자');
  });

  it('BANNED_WORD_BLOCKED는 걸린 단어를 대체 문구 오류에 넣는다', () => {
    const r = mapRuleServerError(err(400, 'BANNED_WORD_BLOCKED', [{ field: 'replacementText', message: '욕설' }]), []);
    expect(r.errors.replacementText).toBe('대체 문구에 금지어(욕설)가 들어 있어 저장할 수 없습니다. 문구를 고쳐 주세요.');
  });

  it('DUPLICATE_NAME·LIMIT_EXCEEDED·CHATBOT_ARCHIVED·404', () => {
    expect(mapRuleServerError(err(409, 'DUPLICATE_NAME'), []).errors.name).toContain('같은 이름');
    expect(mapRuleServerError(err(409, 'LIMIT_EXCEEDED'), []).errors.form).toContain('한도');
    expect(mapRuleServerError(err(409, 'CHATBOT_ARCHIVED'), []).errors.form).toBe('보관된 챗봇은 규칙을 바꿀 수 없습니다.');
    const nf = mapRuleServerError(err(404, 'NOT_FOUND'), []);
    expect(nf.notFound).toBe(true);
    expect(nf.errors.form).toContain('삭제했을 수 있습니다');
  });
});
