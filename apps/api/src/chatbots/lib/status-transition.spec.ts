import { evaluateStatusTransition } from './status-transition';

describe('evaluateStatusTransition', () => {
  it('treats same-status requests as no-op (NFR-A3 멱등성)', () => {
    expect(evaluateStatusTransition('DRAFT', 'DRAFT')).toEqual({ kind: 'noop' });
    expect(evaluateStatusTransition('ACTIVE', 'ACTIVE')).toEqual({ kind: 'noop' });
    expect(evaluateStatusTransition('ARCHIVED', 'ARCHIVED')).toEqual({ kind: 'noop' });
  });

  it('allows DRAFT -> ACTIVE and DRAFT -> ARCHIVED', () => {
    expect(evaluateStatusTransition('DRAFT', 'ACTIVE')).toEqual({ kind: 'allowed' });
    expect(evaluateStatusTransition('DRAFT', 'ARCHIVED')).toEqual({ kind: 'allowed' });
  });

  it('allows ACTIVE -> ARCHIVED but denies ACTIVE -> DRAFT', () => {
    expect(evaluateStatusTransition('ACTIVE', 'ARCHIVED')).toEqual({ kind: 'allowed' });
    expect(evaluateStatusTransition('ACTIVE', 'DRAFT')).toEqual({ kind: 'denied' });
  });

  it('allows ARCHIVED -> DRAFT but denies ARCHIVED -> ACTIVE directly (AC-1-13)', () => {
    expect(evaluateStatusTransition('ARCHIVED', 'DRAFT')).toEqual({ kind: 'allowed' });
    expect(evaluateStatusTransition('ARCHIVED', 'ACTIVE')).toEqual({ kind: 'denied' });
  });
});
