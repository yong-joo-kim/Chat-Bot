import { buildRuleChangeSummary } from './rule-audit-summary';

describe('buildRuleChangeSummary — 바뀐 항목 이름만(원문 0)', () => {
  it('바뀐 필드의 한글 이름만 반환한다', () => {
    const before = { name: 'A', text: '문구1', buttons: '[]' };
    const after = { name: 'B', text: '문구1', buttons: '[{"a":1}]' };
    expect(buildRuleChangeSummary(before, after, ['name', 'text', 'buttons'])).toEqual(['이름', '버튼']);
  });

  it('변경 없으면 빈 배열', () => {
    const before = { name: 'A' };
    const after = { name: 'A' };
    expect(buildRuleChangeSummary(before, after, ['name'])).toEqual([]);
  });

  it('Date 값도 비교할 수 있다', () => {
    const before = { startsAt: new Date('2026-01-01T00:00:00Z') };
    const after = { startsAt: new Date('2026-01-02T00:00:00Z') };
    expect(buildRuleChangeSummary(before, after, ['startsAt'])).toEqual(['게시 시작']);
  });

  it('null ↔ 값 변경도 감지한다', () => {
    const before = { schedule: null };
    const after = { schedule: '{"days":[0]}' };
    expect(buildRuleChangeSummary(before, after, ['schedule'])).toEqual(['표시 시간대']);
  });

  it('반환값에 원문 텍스트가 포함되지 않는다(필드 이름만)', () => {
    const before = { text: '원문 절대 노출 금지 비밀문구' };
    const after = { text: '다른 문구' };
    const result = buildRuleChangeSummary(before, after, ['text']);
    expect(result).toEqual(['문구']);
    expect(result.join(' ')).not.toContain('비밀문구');
  });
});
