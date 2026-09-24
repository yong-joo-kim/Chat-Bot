import { pickTopSemanticCandidates } from './hint-rank';

describe('pickTopSemanticCandidates — §12.2', () => {
  it('상위 N개만 자른다(이미 점수 내림차순으로 정렬된 입력을 신뢰한다)', () => {
    const ranked = [
      { kind: 'FAQ' as const, id: 'a', score: 0.9 },
      { kind: 'INTENT' as const, id: 'b', score: 0.8 },
      { kind: 'FAQ' as const, id: 'c', score: 0.7 },
      { kind: 'INTENT' as const, id: 'd', score: 0.6 },
    ];
    expect(pickTopSemanticCandidates(ranked, 3)).toEqual(ranked.slice(0, 3));
  });

  it('입력이 max보다 적으면 그대로 반환한다', () => {
    const ranked = [{ kind: 'FAQ' as const, id: 'a', score: 0.5 }];
    expect(pickTopSemanticCandidates(ranked, 3)).toEqual(ranked);
  });

  it('빈 배열이면 빈 배열을 반환한다', () => {
    expect(pickTopSemanticCandidates([], 3)).toEqual([]);
  });
});
