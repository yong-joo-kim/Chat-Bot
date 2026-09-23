import { judgeTestCase } from './judge-test-case';
import type { JudgeTestCaseLiveIds } from './judge-test-case';

const liveIds: JudgeTestCaseLiveIds = {
  intents: new Set(['intent-1']),
  faqs: new Set(['faq-1']),
  nodes: new Set(['node-1']),
};

describe('judgeTestCase — J-4 판정 4값(ADR-0029 §3)', () => {
  it('ANY는 항상 NOT_JUDGED다', () => {
    expect(judgeTestCase({ kind: 'ANY' }, {}, liveIds)).toBe('NOT_JUDGED');
    expect(judgeTestCase({ kind: 'ANY' }, { matchedIntentId: 'intent-1' }, liveIds)).toBe('NOT_JUDGED');
  });

  it('FALLBACK은 매칭 ID가 전부 없을 때만 PASS다', () => {
    expect(judgeTestCase({ kind: 'FALLBACK' }, {}, liveIds)).toBe('PASS');
    expect(judgeTestCase({ kind: 'FALLBACK' }, { matchedNodeId: 'node-1' }, liveIds)).toBe('FAIL');
  });

  it('INTENT — 대상이 살아있고 일치하면 PASS, 불일치면 FAIL', () => {
    expect(judgeTestCase({ kind: 'INTENT', targetId: 'intent-1' }, { matchedIntentId: 'intent-1' }, liveIds)).toBe('PASS');
    expect(judgeTestCase({ kind: 'INTENT', targetId: 'intent-1' }, { matchedIntentId: 'other' }, liveIds)).toBe('FAIL');
  });

  it('INTENT — 대상 ID가 현재 자산에 없으면 UNRESOLVED다(FAIL로 집계되지 않는다)', () => {
    expect(judgeTestCase({ kind: 'INTENT', targetId: 'deleted-intent' }, { matchedIntentId: 'deleted-intent' }, liveIds)).toBe('UNRESOLVED');
  });

  it('INTENT — targetId가 없으면(잘못된 데이터) UNRESOLVED로 안전 처리한다', () => {
    expect(judgeTestCase({ kind: 'INTENT' }, {}, liveIds)).toBe('UNRESOLVED');
  });

  it('FAQ/NODE도 동일 규칙을 따른다', () => {
    expect(judgeTestCase({ kind: 'FAQ', targetId: 'faq-1' }, { matchedFaqId: 'faq-1' }, liveIds)).toBe('PASS');
    expect(judgeTestCase({ kind: 'NODE', targetId: 'node-1' }, { matchedNodeId: 'other' }, liveIds)).toBe('FAIL');
    expect(judgeTestCase({ kind: 'NODE', targetId: 'gone' }, {}, liveIds)).toBe('UNRESOLVED');
  });
});
