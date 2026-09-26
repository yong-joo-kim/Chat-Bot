import { shouldReopen } from './open-rule';

describe('shouldReopen(순수 함수, §8.1 재열림 규칙)', () => {
  it('OPEN은 어느 트리거로도 재열지 않는다', () => {
    expect(shouldReopen('OPEN', 'SIGNAL')).toBe(false);
    expect(shouldReopen('OPEN', 'MANUAL')).toBe(false);
  });

  it('신호(고객 사건)는 CLOSED·PENDING 모두 연다', () => {
    expect(shouldReopen('CLOSED', 'SIGNAL')).toBe(true);
    expect(shouldReopen('PENDING', 'SIGNAL')).toBe(true);
  });

  it('상담원 사건(수동)은 CLOSED만 열고 PENDING은 유지한다', () => {
    expect(shouldReopen('CLOSED', 'MANUAL')).toBe(true);
    expect(shouldReopen('PENDING', 'MANUAL')).toBe(false);
  });
});
