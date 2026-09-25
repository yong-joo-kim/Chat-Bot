import { computeEnvironmentProtectedIds } from './environment-protected-versions';

describe('computeEnvironmentProtectedIds — §13.2', () => {
  it('모드 꺼짐(포인터 둘 다 null)이면 이력만으로 채워진다', () => {
    const result = computeEnvironmentProtectedIds({
      prodVersionId: null,
      stagingVersionId: null,
      prodHistoryDesc: [{ toVersionId: 'v1' }],
      historyN: 5,
    });
    expect(result).toEqual(new Set(['v1']));
  });

  it('운영·스테이징 포인터를 항상 포함한다', () => {
    const result = computeEnvironmentProtectedIds({ prodVersionId: 'vP', stagingVersionId: 'vS', prodHistoryDesc: [], historyN: 5 });
    expect(result).toEqual(new Set(['vP', 'vS']));
  });

  it('현재 운영을 제외한 최근 N개 이력을 포함한다', () => {
    const result = computeEnvironmentProtectedIds({
      prodVersionId: 'v4',
      stagingVersionId: null,
      prodHistoryDesc: [{ toVersionId: 'v4' }, { toVersionId: 'v3' }, { toVersionId: 'v2' }, { toVersionId: 'v1' }],
      historyN: 2,
    });
    // v4는 현재 운영이라 "이력" 카운트에서 제외되고(이미 별도로 포함됨), 최근 2개(v3, v2)만 이력으로 추가된다.
    expect(result).toEqual(new Set(['v4', 'v3', 'v2']));
  });

  it('null toVersionId(DISABLE 이력)는 건너뛴다', () => {
    const result = computeEnvironmentProtectedIds({
      prodVersionId: null,
      stagingVersionId: null,
      prodHistoryDesc: [{ toVersionId: null }, { toVersionId: 'v1' }],
      historyN: 5,
    });
    expect(result).toEqual(new Set(['v1']));
  });

  it('중복 id는 한 번만 카운트된다', () => {
    const result = computeEnvironmentProtectedIds({
      prodVersionId: 'v3',
      stagingVersionId: null,
      prodHistoryDesc: [{ toVersionId: 'v3' }, { toVersionId: 'v2' }, { toVersionId: 'v2' }, { toVersionId: 'v1' }],
      historyN: 2,
    });
    expect(result).toEqual(new Set(['v3', 'v2', 'v1']));
  });
});
