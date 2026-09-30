import { compileProfile } from './compile-profile';
import { evaluateRules } from './evaluate-rules';
import type { GuardrailRuleRow } from './types';

/** N36-2 — 위험 응답 규칙도 금지어 `detect()`를 재사용하므로 제로폭 삽입 회피가 막혀야 한다. */
function rule(overrides: Partial<GuardrailRuleRow> = {}): GuardrailRuleRow {
  return {
    id: 'r-1',
    name: '테스트 규칙',
    category: 'OTHER',
    expressions: ['테스트금지'],
    matchType: 'CONTAINS',
    appliesTo: 'BOTH',
    action: 'REPLACE',
    replacementText: '안전 문구',
    sortOrder: 1,
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

describe('evaluateRules — 제로폭 삽입 회피 차단(N36-2)', () => {
  it.each(['\u200B', '\u200C', '\u200D', '\uFEFF', '\u00AD'])('입구/출구 모두 U+%s 삽입 입력을 잡는다', (z) => {
    const p = compileProfile([rule()]);
    expect(evaluateRules(`테스트${z}금지`, p.inbound).action).toBe('REPLACE');
    expect(evaluateRules(`앞 테${z}스${z}트금지 뒤`, p.outbound).action).toBe('REPLACE');
  });

  it('규칙 표현에 제로폭이 들어 있어도(컴파일 시 정리) 정상 입력과 삽입 입력 모두 적중', () => {
    const p = compileProfile([rule({ expressions: ['테스트\u200B금지'] })]);
    expect(evaluateRules('테스트금지', p.inbound).action).toBe('REPLACE');
    expect(evaluateRules('테\u200D스트금지', p.inbound).action).toBe('REPLACE');
  });

  it('제로폭 없는 무관 문장은 PASS', () => {
    expect(evaluateRules('전혀 다른 문장', compileProfile([rule()]).inbound).action).toBe('PASS');
  });
});
