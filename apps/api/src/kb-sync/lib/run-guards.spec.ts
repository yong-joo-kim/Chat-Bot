import { evaluateRunGuards } from './run-guards';

const base = { priorActiveIngestedCount: 0, addedCount: 0, observedHtmlCount: 0, hashedHtmlCount: 0, sameHashHtmlMaxCount: 0 };

describe('evaluateRunGuards', () => {
  it('새로 비율 경계(20건·50%) 이상이면 NEW_RATIO', () => {
    expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 20, addedCount: 11 })).toBe('NEW_RATIO');
  });
  it('20건 미만이면 비율이 높아도 강등하지 않는다', () => {
    expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 19, addedCount: 19 })).toBeNull();
  });
  it('인증 벽(지문 행 10건 이상 · 방문 HTML의 80% 이상)이면 AUTH_WALL', () => {
    expect(evaluateRunGuards({ ...base, observedHtmlCount: 10, hashedHtmlCount: 10, sameHashHtmlMaxCount: 8 })).toBe('AUTH_WALL');
  });
  it('둘 다 해당하지 않으면 null', () => {
    expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 20, addedCount: 2, observedHtmlCount: 10, hashedHtmlCount: 10, sameHashHtmlMaxCount: 1 })).toBeNull();
  });

  describe('pass 10 · RG-23 — 승인으로 시작된 실행은 새로 비율만 면제한다', () => {
    it('★ approvedByUser면 새 비율이 커도 NEW_RATIO로 강등하지 않는다', () => {
      expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 20, addedCount: 30, approvedByUser: true })).toBeNull();
      expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 20, addedCount: 30, approvedByUser: false })).toBe('NEW_RATIO');
    });
    it('★ approvedByUser여도 인증 벽은 그대로 강등한다', () => {
      expect(evaluateRunGuards({ ...base, priorActiveIngestedCount: 20, addedCount: 30, observedHtmlCount: 10, hashedHtmlCount: 10, sameHashHtmlMaxCount: 9, approvedByUser: true })).toBe('AUTH_WALL');
    });
  });

  describe('pass 9 · H-1 — 분모는 방문한 HTML 행 전체(304 포함)다', () => {
    it('★ 지문 행이 13건 · 최빈 12건이어도 방문 HTML이 43건(304 30건 포함)이면 강등하지 않는다', () => {
      expect(evaluateRunGuards({ ...base, observedHtmlCount: 43, hashedHtmlCount: 13, sameHashHtmlMaxCount: 12 })).toBeNull();
    });
    it('경계: 최빈 ÷ 방문 = 0.8이면 강등, 그 아래면 아니다', () => {
      expect(evaluateRunGuards({ ...base, observedHtmlCount: 15, hashedHtmlCount: 12, sameHashHtmlMaxCount: 12 })).toBe('AUTH_WALL');
      expect(evaluateRunGuards({ ...base, observedHtmlCount: 16, hashedHtmlCount: 12, sameHashHtmlMaxCount: 12 })).toBeNull();
    });
    it('하한: 지문 행이 10건 미만이면 최빈이 방문 전체여도 판정하지 않는다', () => {
      expect(evaluateRunGuards({ ...base, observedHtmlCount: 9, hashedHtmlCount: 9, sameHashHtmlMaxCount: 9 })).toBeNull();
    });
    it('방문 HTML이 0이면 나누지 않는다', () => {
      expect(evaluateRunGuards({ ...base })).toBeNull();
    });
  });
});
