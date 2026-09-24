import { archivedAtPatch, evaluateStatusTransition } from './status-transition';

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

describe('archivedAtPatch (No.29 §3.5, ADR-0033)', () => {
  const now = new Date('2026-09-24T00:00:00.000Z');

  it('sets archivedAt on entering ARCHIVED from a non-archived state', () => {
    expect(archivedAtPatch('DRAFT', 'ARCHIVED', now)).toEqual({ archivedAt: now });
    expect(archivedAtPatch('ACTIVE', 'ARCHIVED', now)).toEqual({ archivedAt: now });
  });

  it('clears archivedAt on leaving ARCHIVED', () => {
    expect(archivedAtPatch('ARCHIVED', 'DRAFT', now)).toEqual({ archivedAt: null });
  });

  it('returns an empty patch for same-status/no-archive-boundary transitions', () => {
    expect(archivedAtPatch('DRAFT', 'DRAFT', now)).toEqual({});
    expect(archivedAtPatch('DRAFT', 'ACTIVE', now)).toEqual({});
    expect(archivedAtPatch('ARCHIVED', 'ARCHIVED', now)).toEqual({});
  });
});
