import { evaluateRuleIssues, isPublicBlockingIssue, shouldExcludeFromPublic } from './rule-servability';
import type { DecodedProactiveRule } from './rule-codec';

const DECODED: DecodedProactiveRule = {
  trigger: { kind: 'PAGE_DWELL', pathInclude: ['/**'], pathExclude: [], dwellSec: 30 },
  buttons: [{ label: '이동', action: 'NODE', value: 'node-1' }],
  devices: ['DESKTOP'],
  schedule: null,
};

describe('evaluateRuleIssues', () => {
  it('decoded가 null이면 INVALID_STORED만', () => {
    expect(evaluateRuleIssues({ decoded: null, servingNodeIds: [], servingUnverifiable: false, bannedWordHit: false, linkOutsidePolicy: false })).toEqual(['INVALID_STORED']);
  });

  it('문제 없으면 빈 배열', () => {
    expect(evaluateRuleIssues({ decoded: DECODED, servingNodeIds: ['node-1'], servingUnverifiable: false, bannedWordHit: false, linkOutsidePolicy: false })).toEqual([]);
  });

  it('NODE 버튼 대상이 서비스 중 번들에 없으면 TARGET_UNAVAILABLE', () => {
    expect(evaluateRuleIssues({ decoded: DECODED, servingNodeIds: [], servingUnverifiable: false, bannedWordHit: false, linkOutsidePolicy: false })).toEqual(['TARGET_UNAVAILABLE']);
  });

  it('버전 읽기 실패면 SERVING_UNVERIFIABLE(TARGET_UNAVAILABLE 대신)', () => {
    expect(evaluateRuleIssues({ decoded: DECODED, servingNodeIds: [], servingUnverifiable: true, bannedWordHit: false, linkOutsidePolicy: false })).toEqual(['SERVING_UNVERIFIABLE']);
  });

  it('NODE 버튼이 없는 규칙은 노드 판정을 하지 않는다', () => {
    const decoded: DecodedProactiveRule = { ...DECODED, buttons: [] };
    expect(evaluateRuleIssues({ decoded, servingNodeIds: [], servingUnverifiable: true, bannedWordHit: false, linkOutsidePolicy: false })).toEqual([]);
  });

  it('금지어·허용 도메인 밖은 함께 누적된다', () => {
    const issues = evaluateRuleIssues({ decoded: DECODED, servingNodeIds: ['node-1'], servingUnverifiable: false, bannedWordHit: true, linkOutsidePolicy: true });
    expect(issues).toEqual(['BANNED_WORD', 'LINK_OUTSIDE_POLICY']);
  });
});

describe('isPublicBlockingIssue / shouldExcludeFromPublic — K-8', () => {
  it('LINK_OUTSIDE_POLICY는 공개 조회 제외 사유가 아니다', () => {
    expect(isPublicBlockingIssue('LINK_OUTSIDE_POLICY')).toBe(false);
    expect(shouldExcludeFromPublic(['LINK_OUTSIDE_POLICY'])).toBe(false);
  });

  it('나머지 issue는 공개 조회에서 제외한다', () => {
    expect(shouldExcludeFromPublic(['TARGET_UNAVAILABLE'])).toBe(true);
    expect(shouldExcludeFromPublic(['BANNED_WORD'])).toBe(true);
    expect(shouldExcludeFromPublic(['INVALID_STORED'])).toBe(true);
    expect(shouldExcludeFromPublic(['SERVING_UNVERIFIABLE'])).toBe(true);
  });

  it('빈 배열은 제외하지 않는다', () => {
    expect(shouldExcludeFromPublic([])).toBe(false);
  });
});
