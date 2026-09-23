import { findPredecessor, hasActivePublish, hasLaterActiveRestore, preservesOrder, successorsToHold } from './chain-rules';

const d = (iso: string) => new Date(iso);

describe('chain-rules(§6.2, §7.7, §18)', () => {
  describe('R1 findPredecessor', () => {
    it('선행 없음 → null', () => {
      expect(findPredecessor([], d('2027-01-01T00:00:00Z'))).toBeNull();
    });

    it('선행이 하나면 그것을 반환한다', () => {
      const pred = { id: 'a', scheduledAt: d('2026-12-01T00:00:00Z'), targetContentHash: 'hash-a' };
      expect(findPredecessor([pred], d('2027-01-01T00:00:00Z'))).toEqual(pred);
    });

    it('선행이 여럿이면 가장 늦은 것을 반환한다', () => {
      const early = { id: 'a', scheduledAt: d('2026-11-01T00:00:00Z'), targetContentHash: 'hash-a' };
      const late = { id: 'b', scheduledAt: d('2026-12-01T00:00:00Z'), targetContentHash: 'hash-b' };
      expect(findPredecessor([early, late], d('2027-01-01T00:00:00Z'))?.id).toBe('b');
    });

    it('자신보다 늦은 예약은 선행 후보에서 제외된다', () => {
      const later = { id: 'c', scheduledAt: d('2027-02-01T00:00:00Z'), targetContentHash: 'hash-c' };
      expect(findPredecessor([later], d('2027-01-01T00:00:00Z'))).toBeNull();
    });
  });

  describe('R2 hasLaterActiveRestore(append-only)', () => {
    it('뒤에 활성 복원 예약이 있으면 true', () => {
      expect(hasLaterActiveRestore([{ scheduledAt: d('2027-02-01T00:00:00Z') }], d('2027-01-01T00:00:00Z'))).toBe(true);
    });
    it('전부 앞선 예약뿐이면 false', () => {
      expect(hasLaterActiveRestore([{ scheduledAt: d('2026-12-01T00:00:00Z') }], d('2027-01-01T00:00:00Z'))).toBe(false);
    });
  });

  describe('R3 preservesOrder', () => {
    const others = [{ scheduledAt: d('2027-01-01T00:00:00Z') }, { scheduledAt: d('2027-03-01T00:00:00Z') }];
    it('중간 슬롯 안에서 이동하면 순서 보존(true)', () => {
      expect(preservesOrder(d('2027-02-01T00:00:00Z'), d('2027-02-15T00:00:00Z'), others)).toBe(true);
    });
    it('앞선 예약보다 이전으로 옮기면 순서가 깨진다(false)', () => {
      expect(preservesOrder(d('2027-02-01T00:00:00Z'), d('2026-12-01T00:00:00Z'), others)).toBe(false);
    });
    it('뒤 예약보다 이후로 옮기면 순서가 깨진다(false)', () => {
      expect(preservesOrder(d('2027-02-01T00:00:00Z'), d('2027-04-01T00:00:00Z'), others)).toBe(false);
    });
  });

  describe('successorsToHold(§7.7)', () => {
    const rows = [
      { id: 'x', action: 'RESTORE_VERSION' as const, scheduledAt: d('2027-01-01T00:00:00Z') },
      { id: 'y', action: 'PUBLISH' as const, scheduledAt: d('2027-02-01T00:00:00Z') },
      { id: 'z', action: 'RESTORE_VERSION' as const, scheduledAt: d('2027-03-01T00:00:00Z') },
    ];
    it('FAILED/MISSED 트리거(동작 무관)는 트리거보다 늦은 전부를 대상으로 한다', () => {
      expect(successorsToHold(rows, d('2027-01-15T00:00:00Z'))).toEqual(['y', 'z']);
    });
    it('취소 트리거(restoreOnly)는 RESTORE_VERSION만 대상으로 한다', () => {
      expect(successorsToHold(rows, d('2027-01-15T00:00:00Z'), { restoreOnly: true })).toEqual(['z']);
    });
  });

  describe('R7 hasActivePublish', () => {
    it('활성 PUBLISH가 있으면 true', () => {
      expect(hasActivePublish([{ action: 'PUBLISH' }])).toBe(true);
    });
    it('없으면 false', () => {
      expect(hasActivePublish([{ action: 'SET_WEB_CHANNEL' }])).toBe(false);
    });
  });
});
