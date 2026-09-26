import { isWithinKstWindow, nextWindowStart, parseWindow } from './retention-window';

describe('governance/lib/retention-window(No.45) — KST 실행 창 판정', () => {
  describe('parseWindow', () => {
    it('형식이 올바르면 분 단위로 파싱한다', () => {
      expect(parseWindow('02:00-05:00')).toEqual({ startMin: 120, endMin: 300 });
    });
    it('형식이 틀리면 null', () => {
      expect(parseWindow('2:00-5:00')).toBeNull();
      expect(parseWindow('02:00~05:00')).toBeNull();
    });
  });

  describe('isWithinKstWindow', () => {
    it('창 안의 시각은 true', () => {
      // KST 03:00 = UTC 전날 18:00
      const now = new Date('2026-03-09T18:00:00Z');
      expect(isWithinKstWindow(now, '02:00-05:00')).toBe(true);
    });

    it('창 밖의 시각은 false', () => {
      // KST 10:00 = UTC 01:00
      const now = new Date('2026-03-10T01:00:00Z');
      expect(isWithinKstWindow(now, '02:00-05:00')).toBe(false);
    });

    it('자정 넘김 창(22:00-02:00)을 지원한다', () => {
      // KST 23:00 = UTC 14:00
      const inWindow1 = new Date('2026-03-09T14:00:00Z');
      // KST 01:00 = UTC 전날 16:00
      const inWindow2 = new Date('2026-03-09T16:00:00Z');
      // KST 12:00 = UTC 03:00
      const outOfWindow = new Date('2026-03-10T03:00:00Z');
      expect(isWithinKstWindow(inWindow1, '22:00-02:00')).toBe(true);
      expect(isWithinKstWindow(inWindow2, '22:00-02:00')).toBe(true);
      expect(isWithinKstWindow(outOfWindow, '22:00-02:00')).toBe(false);
    });

    it('잘못된 형식이면 false', () => {
      expect(isWithinKstWindow(new Date(), 'invalid')).toBe(false);
    });
  });

  describe('nextWindowStart', () => {
    it('창 밖 · 오늘 시작 전이면 오늘 KST 시작 시각', () => {
      // KST 01:00 = UTC 전날 16:00 → 오늘 KST 02:00 시작
      const now = new Date('2026-03-09T16:00:00Z');
      const result = nextWindowStart(now, '02:00-05:00');
      expect(result.toISOString()).toBe('2026-03-09T17:00:00.000Z'); // KST 2026-03-10 02:00
    });

    it('창 밖 · 오늘 창이 이미 지났으면 내일 KST 시작 시각', () => {
      // KST 10:00 = UTC 01:00
      const now = new Date('2026-03-10T01:00:00Z');
      const result = nextWindowStart(now, '02:00-05:00');
      expect(result.toISOString()).toBe('2026-03-10T17:00:00.000Z'); // KST 2026-03-11 02:00
    });

    it('이미 창 안이면 now를 그대로 반환한다(다음 tick에서 곧 실행)', () => {
      const now = new Date('2026-03-09T18:00:00Z'); // KST 03:00
      expect(nextWindowStart(now, '02:00-05:00').getTime()).toBe(now.getTime());
    });

    it('형식 오류면 24시간 뒤로 안전 폴백', () => {
      const now = new Date('2026-03-09T18:00:00Z');
      expect(nextWindowStart(now, 'invalid').getTime()).toBe(now.getTime() + 86_400_000);
    });
  });
});
