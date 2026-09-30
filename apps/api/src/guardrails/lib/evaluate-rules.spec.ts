import { compileProfile } from './compile-profile';
import { evaluateRules } from './evaluate-rules';
import { pickStrongest } from './strongest-action';
import type { GuardrailRuleRow } from './types';

let seq = 0;
function rule(overrides: Partial<GuardrailRuleRow> = {}): GuardrailRuleRow {
  seq += 1;
  return {
    id: `rule-${seq}`,
    name: `규칙${seq}`,
    category: 'OTHER',
    expressions: ['위험표현'],
    matchType: 'CONTAINS',
    appliesTo: 'INBOUND',
    action: 'MONITOR',
    replacementText: null,
    sortOrder: seq,
    createdAt: new Date(2026, 0, seq),
    ...overrides,
  };
}

describe('compileProfile — 금지어 사전 모양으로 컴파일(설계서 §4.3)', () => {
  it('appliesTo 별로 입구/출구 사전에 나눠 담는다(BOTH는 양쪽)', () => {
    const p = compileProfile([rule({ appliesTo: 'INBOUND', expressions: ['입구표현'] }), rule({ appliesTo: 'OUTBOUND', expressions: ['출구표현'] }), rule({ appliesTo: 'BOTH', expressions: ['양쪽표현'] })]);
    expect(p.inbound.entries.map((e) => e.wordNormalized).sort()).toEqual(['양쪽표현', '입구표현']);
    expect(p.outbound.entries.map((e) => e.wordNormalized).sort()).toEqual(['양쪽표현', '출구표현']);
  });

  it('같은 (정규화 표현, 방식)은 항목 1개로 합치고 두 규칙을 역참조에 모은다', () => {
    const a = rule({ expressions: ['같은표현'] });
    const b = rule({ expressions: ['같은  표현'.replace('  ', '')] });
    const p = compileProfile([a, b]);
    expect(p.inbound.entries).toHaveLength(1);
    expect(p.inbound.refs.get(p.inbound.entries[0])!.map((r) => r.ruleId)).toEqual([a.id, b.id]);
  });

  it('출구 REPLACE가 있으면 hasOutboundReplace', () => {
    expect(compileProfile([rule({ appliesTo: 'OUTBOUND', action: 'REPLACE', replacementText: '대체' })]).hasOutboundReplace).toBe(true);
    expect(compileProfile([rule({ appliesTo: 'INBOUND', action: 'REPLACE', replacementText: '대체' })]).hasOutboundReplace).toBe(false);
  });
});

describe('evaluateRules — 판정(설계서 §4.3)', () => {
  it('사전이 비어 있으면 정규화조차 하지 않고 즉시 PASS(normalizeText → String.normalize 호출 0)', () => {
    // `normalizeText`는 첫 줄에서 `text.normalize('NFKC')`를 부른다 — 그 호출이 0인지 프로브 객체로 확인한다.
    const probe = { normalize: jest.fn(() => 'x') };
    const empty = compileProfile([]);
    expect(evaluateRules(probe as unknown as string, empty.inbound)).toEqual({ action: 'PASS', hits: [] });
    expect(probe.normalize).not.toHaveBeenCalled();

    const nonEmpty = compileProfile([rule()]);
    evaluateRules(probe as unknown as string, nonEmpty.inbound);
    expect(probe.normalize).toHaveBeenCalled();
  });

  it('적중이 없으면 PASS', () => {
    const profile = compileProfile([rule()]);
    expect(evaluateRules('전혀 관계 없는 문장', profile.inbound).action).toBe('PASS');
  });

  it('REPLACE > NO_RAG > MONITOR — 가장 강한 동작이 최종 동작', () => {
    const monitor = rule({ action: 'MONITOR', sortOrder: 1 });
    const noRag = rule({ action: 'NO_RAG', sortOrder: 2 });
    const replace = rule({ action: 'REPLACE', replacementText: '안전 문구', sortOrder: 3 });
    const profile = compileProfile([monitor, noRag, replace]);
    const r = evaluateRules('위험표현이 들어 있는 문장', profile.inbound);
    expect(r.action).toBe('REPLACE');
    expect(r.decisiveRuleId).toBe(replace.id);
    expect(r.replacementText).toBe('안전 문구');
    expect(r.hits.map((h) => h.ruleId)).toEqual([monitor.id, noRag.id, replace.id]);
  });

  it('동률이면 sortOrder → createdAt → id 순으로 결정 규칙을 고른다', () => {
    const first = rule({ action: 'REPLACE', replacementText: 'A', sortOrder: 5, createdAt: new Date(2026, 5, 1), id: 'b' });
    const earlier = rule({ action: 'REPLACE', replacementText: 'B', sortOrder: 5, createdAt: new Date(2026, 4, 1), id: 'z' });
    const byId = rule({ action: 'REPLACE', replacementText: 'C', sortOrder: 5, createdAt: new Date(2026, 4, 1), id: 'a' });
    const r = evaluateRules('위험표현', compileProfile([first, earlier, byId]).inbound);
    expect(r.decisiveRuleId).toBe('a');
    expect(r.replacementText).toBe('C');
    const lower = rule({ action: 'REPLACE', replacementText: 'D', sortOrder: 1, createdAt: new Date(2030, 0, 1), id: 'zzz' });
    expect(evaluateRules('위험표현', compileProfile([first, earlier, byId, lower]).inbound).decisiveRuleId).toBe('zzz');
  });

  it('한 규칙이 여러 표현으로 걸려도 적중 1건이고 적중 표현 목록을 모은다', () => {
    const r1 = rule({ expressions: ['첫째표현', '둘째표현'] });
    const r = evaluateRules('첫째표현 그리고 둘째표현', compileProfile([r1]).inbound);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].matched.sort()).toEqual(['둘째표현', '첫째표현']);
  });

  it('EXACT는 토큰 일치일 때만 걸린다', () => {
    const r1 = rule({ matchType: 'EXACT', expressions: ['위험'] });
    const profile = compileProfile([r1]);
    expect(evaluateRules('위험 신호', profile.inbound).action).toBe('MONITOR');
    expect(evaluateRules('위험한 신호', profile.inbound).action).toBe('PASS');
  });

  it('단계 분리 — 출구 전용 규칙은 입구 사전에서 걸리지 않는다', () => {
    const profile = compileProfile([rule({ appliesTo: 'OUTBOUND' })]);
    expect(evaluateRules('위험표현', profile.inbound).action).toBe('PASS');
    expect(evaluateRules('위험표현', profile.outbound).action).toBe('MONITOR');
  });
});

describe('pickStrongest', () => {
  it('적중이 없으면 null', () => {
    expect(pickStrongest([])).toBeNull();
  });
});
