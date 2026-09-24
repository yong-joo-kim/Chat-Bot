import { canViewRaw } from './raw-visibility';
import type { RawVisibilityViewer } from './raw-visibility';

const HANDOFF = { status: 'CONNECTED' as const, assignedUserId: 'agent-1' };

function viewer(overrides: Partial<RawVisibilityViewer> = {}): RawVisibilityViewer {
  return { id: 'agent-1', role: 'AGENT', permissions: ['cs:read', 'cs:write'], ...overrides };
}

describe('canViewRaw — §9.3', () => {
  it('담당 상담원이 includeRaw=true로 요청하면 통과한다', () => {
    expect(canViewRaw(HANDOFF, viewer(), true)).toBe(true);
  });

  it('includeRaw가 없으면 통과하지 않는다', () => {
    expect(canViewRaw(HANDOFF, viewer(), false)).toBe(false);
  });

  it('상담이 CONNECTED가 아니면 통과하지 않는다(종료 후 원문 없음)', () => {
    expect(canViewRaw({ ...HANDOFF, status: 'ENDED' }, viewer(), true)).toBe(false);
  });

  it('cs:write가 없으면 통과하지 않는다', () => {
    expect(canViewRaw(HANDOFF, viewer({ permissions: ['cs:read'] }), true)).toBe(false);
  });

  it('담당이 아닌 AGENT는 통과하지 않는다', () => {
    expect(canViewRaw(HANDOFF, viewer({ id: 'agent-2' }), true)).toBe(false);
  });

  it('담당이 아닌 ADMIN은 통과한다', () => {
    expect(canViewRaw(HANDOFF, viewer({ id: 'admin-1', role: 'ADMIN', permissions: ['cs:read', 'cs:write'] }), true)).toBe(true);
  });

  it('EDITOR(cs:read만)는 통과하지 않는다', () => {
    expect(canViewRaw(HANDOFF, viewer({ id: 'agent-1', role: 'EDITOR', permissions: ['cs:read'] }), true)).toBe(false);
  });
});
