import { computeCutoff, judgeShorten, resolveEffectiveDays, resolveGlobalStoredDays, validateRange } from './retention-policy';
import type { RetentionBounds } from './retention-policy';

const BOUNDS: RetentionBounds = { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 };

describe('governance/lib/retention-policy(No.45) — 순수 함수', () => {
  describe('resolveGlobalStoredDays', () => {
    it('키가 없으면 무기한(null)', () => {
      expect(resolveGlobalStoredDays('CONVERSATION_TEXT', {}, {}, new Date())).toBeNull();
    });

    it('저장값을 그대로 돌려준다(pending 없음)', () => {
      expect(resolveGlobalStoredDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 180 }, {}, new Date())).toBe(180);
    });

    it('도래한 pending은 즉시 반영된다', () => {
      const now = new Date('2026-01-10T00:00:00Z');
      const pending = { CONVERSATION_TEXT: { days: 90, effectiveAt: '2026-01-09T00:00:00Z' } };
      expect(resolveGlobalStoredDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 180 }, pending, now)).toBe(90);
    });

    it('도래하지 않은 pending은 저장값을 그대로 쓴다', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const pending = { CONVERSATION_TEXT: { days: 90, effectiveAt: '2026-01-09T00:00:00Z' } };
      expect(resolveGlobalStoredDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 180 }, pending, now)).toBe(180);
    });
  });

  describe('resolveEffectiveDays — 하한 클램프', () => {
    it('저장값이 하한 미만이면 실행 시 하한으로 클램프한다(환경변수 하한이 나중에 올라간 경우)', () => {
      const result = resolveEffectiveDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 3 }, {}, null, null, new Date(), BOUNDS);
      expect(result).toBe(7);
    });

    it('AUDIT_LOGS는 감사 하한을 쓴다', () => {
      const result = resolveEffectiveDays('AUDIT_LOGS', { AUDIT_LOGS: 10 }, {}, null, null, new Date(), BOUNDS);
      expect(result).toBe(365);
    });

    it('무기한(null)은 클램프 대상이 아니다', () => {
      expect(resolveEffectiveDays('CONVERSATION_TEXT', {}, {}, null, null, new Date(), BOUNDS)).toBeNull();
    });

    it('챗봇 재정의가 전역보다 작아도 반영된다(대화 원천 4종만)', () => {
      const result = resolveEffectiveDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 180 }, {}, { CONVERSATION_TEXT: 90 }, {}, new Date(), BOUNDS);
      expect(result).toBe(90);
    });

    it("챗봇 값이 'GLOBAL'이면 전역을 따른다", () => {
      const result = resolveEffectiveDays('CONVERSATION_TEXT', { CONVERSATION_TEXT: 180 }, {}, { CONVERSATION_TEXT: 'GLOBAL' }, {}, new Date(), BOUNDS);
      expect(result).toBe(180);
    });

    it('CALL_LOGS·AUDIT_LOGS는 챗봇 재정의를 받지 않는다(챗봇 값이 있어도 무시)', () => {
      const result = resolveEffectiveDays('CALL_LOGS', { CALL_LOGS: 30 }, {}, { CALL_LOGS: 5 } as never, {}, new Date(), BOUNDS);
      expect(result).toBe(30);
    });
  });

  describe('computeCutoff — KST 자정 기준', () => {
    it('같은 KST 날짜 안에서는 몇 번을 계산해도 cutoff가 같다', () => {
      const morning = new Date('2026-03-10T01:00:00+09:00');
      const evening = new Date('2026-03-10T23:00:00+09:00');
      const a = computeCutoff(7, morning);
      const b = computeCutoff(7, evening);
      expect(a.getTime()).toBe(b.getTime());
    });

    it('7일 전 KST 자정을 반환한다', () => {
      const now = new Date('2026-03-10T05:00:00+09:00'); // KST 2026-03-10 05:00
      const cutoff = computeCutoff(7, now);
      // KST 2026-03-10 00:00 - 7일 = KST 2026-03-03 00:00 = UTC 2026-03-02T15:00:00Z
      expect(cutoff.toISOString()).toBe('2026-03-02T15:00:00.000Z');
    });
  });

  describe('judgeShorten', () => {
    it('무기한 → 유한은 단축으로 판정한다', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const result = judgeShorten(null, 90, now, 7);
      expect(result.shortening).toBe(true);
      if (result.shortening) expect(result.effectiveAt.getTime()).toBe(now.getTime() + 7 * 86_400_000);
    });

    it('더 큰 값(연장)은 단축이 아니다', () => {
      expect(judgeShorten(90, 180, new Date(), 7)).toEqual({ shortening: false });
    });

    it('같은 값은 단축이 아니다', () => {
      expect(judgeShorten(90, 90, new Date(), 7)).toEqual({ shortening: false });
    });

    it('유한 → 무기한은 단축이 아니다(연장으로 취급)', () => {
      expect(judgeShorten(90, null, new Date(), 7)).toEqual({ shortening: false });
    });
  });

  describe('validateRange', () => {
    it('하한 미만이면 실패 사유 문자열', () => {
      expect(validateRange('CONVERSATION_TEXT', 3, BOUNDS)).not.toBeNull();
    });
    it('상한 초과면 실패 사유 문자열', () => {
      expect(validateRange('CONVERSATION_TEXT', 4000, BOUNDS)).not.toBeNull();
    });
    it('범위 안이면 null', () => {
      expect(validateRange('CONVERSATION_TEXT', 180, BOUNDS)).toBeNull();
    });
    it('무기한(null)은 항상 통과', () => {
      expect(validateRange('AUDIT_LOGS', null, BOUNDS)).toBeNull();
    });
  });
});
