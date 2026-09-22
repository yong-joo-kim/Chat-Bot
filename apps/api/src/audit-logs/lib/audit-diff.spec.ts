import { computeChangedFields } from './audit-diff';

describe('computeChangedFields — FR-13-18', () => {
  it('값이 달라진 키만 반환한다', () => {
    const changed = computeChangedFields({ name: 'A', role: 'VIEWER' }, { name: 'B', role: 'VIEWER' });
    expect(changed).toEqual(['name']);
  });

  it('before/after 어느 한쪽에만 있는 키도 변경으로 간주한다', () => {
    const changed = computeChangedFields({ name: 'A' }, { name: 'A', role: 'ADMIN' });
    expect(changed).toEqual(['role']);
  });

  it('null 스냅샷은 빈 객체로 취급한다', () => {
    expect(computeChangedFields(null, { name: 'A' })).toEqual(['name']);
    expect(computeChangedFields({ name: 'A' }, null)).toEqual(['name']);
  });

  it('완전히 동일하면 빈 배열이다', () => {
    expect(computeChangedFields({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
