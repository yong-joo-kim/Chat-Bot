import { ClusterItem, postprocessClusters, resolveClusterCount } from './cluster-postprocess';

function item(normalized: string, assignment: number, similarity: number, count = 1): ClusterItem {
  return { normalized, assignment, similarity, count };
}

describe('resolveClusterCount (§5.4-1)', () => {
  it('kMax = floor(n / 최소 크기), k = min(목표, kMax)', () => {
    expect(resolveClusterCount(100, 5, 10)).toEqual({ kMax: 20, k: 10, reduced: false, tooFew: false });
    expect(resolveClusterCount(30, 5, 10)).toEqual({ kMax: 6, k: 6, reduced: true, tooFew: false });
  });
  it('kMax < 2이면 tooFew(요청 단계 400)', () => {
    expect(resolveClusterCount(9, 5, 10)).toMatchObject({ kMax: 1, k: 0, tooFew: true });
    expect(resolveClusterCount(10, 5, 10)).toMatchObject({ kMax: 2, k: 2, tooFew: false, reduced: true });
  });
});

describe('postprocessClusters (§5.4)', () => {
  it('최소 크기 미만 묶음은 미분류가 되고 맨 끝 번호(m+1)를 받는다', () => {
    const items: ClusterItem[] = [
      ...['a1', 'a2', 'a3'].map((t, i) => item(t, 0, 0.9 - i * 0.1)),
      ...['b1', 'b2', 'b3', 'b4'].map((t, i) => item(t, 1, 0.9 - i * 0.1)),
      item('c1', 2, 0.8, 4),
      item('c2', 2, 0.7, 9),
    ];
    const r = postprocessClusters({ items, minClusterSize: 3, targetClusterCount: 3, usedK: 3 });
    expect(r.clusterCount).toBe(2);
    expect(r.clusters.map((c) => [c.ordinal, c.unassigned, c.uniqueCount])).toEqual([
      [1, false, 4], // 고유 발화 수 내림차순 — b 묶음이 1번
      [2, false, 3],
      [3, true, 2],
    ]);
    expect(r.notices).toEqual(['FEWER_THAN_TARGET']);
    // 미분류 대표 발화 = 발생 횟수 내림차순
    expect(r.clusters[2].representativeIndexes.map((i) => items[i].normalized)).toEqual(['c2', 'c1']);
  });

  it('번호 동점: 고유 수가 같으면 발생 횟수 합 내림차순, 그래도 같으면 대표 발화 문자열 오름차순', () => {
    const items: ClusterItem[] = [
      item('x1', 0, 0.9, 1), item('x2', 0, 0.8, 1),
      item('y1', 1, 0.9, 5), item('y2', 1, 0.8, 5),
      item('a1', 2, 0.9, 1), item('a2', 2, 0.8, 1),
    ];
    const r = postprocessClusters({ items, minClusterSize: 2, targetClusterCount: 3, usedK: 3 });
    const repOf = (ord: number) => items[r.clusters[ord - 1].representativeIndexes[0]].normalized;
    expect([repOf(1), repOf(2), repOf(3)]).toEqual(['y1', 'a1', 'x1']);
  });

  it('입력 순서를 섞어도 같은 묶음 번호·seq(대표 문자열 기준)를 낸다', () => {
    const base: ClusterItem[] = [
      item('가 하나', 0, 0.9), item('가 둘', 0, 0.8), item('가 셋', 0, 0.7),
      item('나 하나', 1, 0.95), item('나 둘', 1, 0.85), item('나 셋', 1, 0.75), item('나 넷', 1, 0.7),
    ];
    const shuffled = [base[4], base[0], base[6], base[2], base[5], base[1], base[3]];
    const view = (items: ClusterItem[]) => {
      const r = postprocessClusters({ items, minClusterSize: 3, targetClusterCount: 2, usedK: 2 });
      return r.itemOrder.map((i) => `${r.ordinalByItem[i]}:${items[i].normalized}`);
    };
    expect(view(shuffled)).toEqual(view(base));
  });

  it('seq는 묶음 번호 → 유사도 내림차순 → 정규화 문자열 오름차순이며 1부터 연속이다', () => {
    const items: ClusterItem[] = [
      item('b', 0, 0.5), item('a', 0, 0.5), item('c', 0, 0.9),
      item('z', 1, 0.4),
    ];
    const r = postprocessClusters({ items, minClusterSize: 3, targetClusterCount: 2, usedK: 2 });
    expect(r.itemOrder.map((i) => items[i].normalized)).toEqual(['c', 'a', 'b', 'z']);
    expect(Array.from(r.seqByItem)).toEqual([3, 2, 1, 4]);
    expect(r.ordinalByItem[3]).toBe(2); // 미분류 = m+1 = 2
    expect(r.clusters[1].unassigned).toBe(true);
  });

  it('대표 발화는 최대 3개(유사도 내림차순, 동점은 문자열 오름차순)', () => {
    const items = ['e', 'd', 'c', 'b', 'a'].map((t) => item(t, 0, 0.5));
    const r = postprocessClusters({ items, minClusterSize: 2, targetClusterCount: 1, usedK: 1 });
    expect(r.clusters[0].representativeIndexes.map((i) => items[i].normalized)).toEqual(['a', 'b', 'c']);
  });

  it('m = 0이면 NO_CLUSTER(전부 미분류) — 분석 실패가 아니다', () => {
    const items = [item('a', 0, 0.9), item('b', 1, 0.9), item('c', 2, 0.9)];
    const r = postprocessClusters({ items, minClusterSize: 2, targetClusterCount: 3, usedK: 3 });
    expect(r.clusterCount).toBe(0);
    expect(r.notices).toEqual(['NO_CLUSTER']);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]).toMatchObject({ ordinal: 1, unassigned: true, uniqueCount: 3 });
  });

  it('목표가 줄었으면 TARGET_REDUCED, 미분류가 없으면 미분류 행을 만들지 않는다', () => {
    const items = [item('a', 0, 0.9), item('b', 0, 0.8), item('c', 1, 0.9), item('d', 1, 0.8)];
    const r = postprocessClusters({ items, minClusterSize: 2, targetClusterCount: 10, usedK: 2 });
    expect(r.notices).toEqual(['TARGET_REDUCED']);
    expect(r.clusters.every((c) => !c.unassigned)).toBe(true);
    expect(r.clusters).toHaveLength(2);
  });

  it('발화 수는 고유 문장 수 — 발생 횟수가 커도 최소 크기를 채우지 못하면 미분류', () => {
    const items = [item('a', 0, 0.9, 1000), item('b', 0, 0.8, 1000), item('c', 1, 0.9), item('d', 1, 0.8), item('e', 1, 0.7)];
    const r = postprocessClusters({ items, minClusterSize: 3, targetClusterCount: 2, usedK: 2 });
    expect(r.clusterCount).toBe(1);
    expect(r.clusters[1]).toMatchObject({ unassigned: true, uniqueCount: 2, occurrenceSum: 2000 });
  });

  it('빈 입력', () => {
    const r = postprocessClusters({ items: [], minClusterSize: 2, targetClusterCount: 2, usedK: 2 });
    expect(r.clusters).toHaveLength(0);
    expect(r.itemOrder).toHaveLength(0);
  });
});
