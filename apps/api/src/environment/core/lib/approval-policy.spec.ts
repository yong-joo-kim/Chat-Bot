import { requiresApproval } from './approval-policy';

const on = { required: true, ttlHours: 24 };
const off = { required: false, ttlHours: 24 };

describe('requiresApproval — 운영 전환 2인 승인 판정(설계서 §10.8)', () => {
  it('정책 꺼짐 = 전환·롤백 모두 불필요(현행과 동일)', () => {
    expect(requiresApproval(off, 'SWITCH', false)).toBe(false);
    expect(requiresApproval(off, 'ROLLBACK', false)).toBe(false);
    expect(requiresApproval(off, 'ROLLBACK', true)).toBe(false);
  });

  it('정책 켜짐 — 전환은 필요', () => {
    expect(requiresApproval(on, 'SWITCH', false)).toBe(true);
  });

  it('정책 켜짐 — 직전 운영 버전 롤백은 예외(불필요)', () => {
    expect(requiresApproval(on, 'ROLLBACK', true)).toBe(false);
  });

  it('정책 켜짐 — 직전이 아닌 이력 버전 롤백은 필요(R-8 · C-9)', () => {
    expect(requiresApproval(on, 'ROLLBACK', false)).toBe(true);
  });

  it('SWITCH에서는 isDirectRollback 값이 무엇이든 필요', () => {
    expect(requiresApproval(on, 'SWITCH', true)).toBe(true);
  });
});
