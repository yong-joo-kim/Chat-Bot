import { isLastActiveAdmin, isSelfModification } from './last-admin';

describe('isSelfModification', () => {
  it('actorId와 targetId가 같으면 true다', () => {
    expect(isSelfModification('u1', 'u1')).toBe(true);
    expect(isSelfModification('u1', 'u2')).toBe(false);
  });
});

describe('isLastActiveAdmin — FR-12-32, C-2', () => {
  it('ACTIVE ADMIN이 1명뿐이면 true다', () => {
    expect(isLastActiveAdmin({ id: 'u1', role: 'ADMIN', status: 'ACTIVE' }, 1)).toBe(true);
  });

  it('ACTIVE ADMIN이 2명 이상이면 false다(AC-12C-6)', () => {
    expect(isLastActiveAdmin({ id: 'u1', role: 'ADMIN', status: 'ACTIVE' }, 2)).toBe(false);
  });

  it('ADMIN이 아니면 false다', () => {
    expect(isLastActiveAdmin({ id: 'u1', role: 'EDITOR', status: 'ACTIVE' }, 1)).toBe(false);
  });

  it('이미 DISABLED 상태면 false다(활성 인원 집계 대상이 아니다)', () => {
    expect(isLastActiveAdmin({ id: 'u1', role: 'ADMIN', status: 'DISABLED' }, 1)).toBe(false);
  });
});
