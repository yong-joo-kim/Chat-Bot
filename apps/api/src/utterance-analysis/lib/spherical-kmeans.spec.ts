import {
  CLUSTERING_ALGORITHM,
  ClusteringCancelledError,
  mulberry32,
  sphericalKMeans,
  sphericalKMeansSync,
} from './spherical-kmeans';

/** 설계 벡터 — 축 `axis` 주변에 결정론적 작은 잡음(dim 16). */
function designed(groups: number, perGroup: number, dim = 16, noise = 0.05): { vectors: Float32Array[]; labels: number[] } {
  const rng = mulberry32(7);
  const vectors: Float32Array[] = [];
  const labels: number[] = [];
  for (let g = 0; g < groups; g++) {
    for (let j = 0; j < perGroup; j++) {
      const v = new Float32Array(dim);
      v[g] = 1;
      for (let d = 0; d < dim; d++) v[d] += (rng() - 0.5) * noise;
      vectors.push(v);
      labels.push(g);
    }
  }
  return { vectors, labels };
}

describe('sphericalKMeans (구면 k-평균)', () => {
  it('상수: 알고리즘 버전과 시드가 코드 상수 1곳에 고정돼 있다', () => {
    expect(CLUSTERING_ALGORITHM).toEqual({ version: 'skmeans-1', seed: 20260930, nInit: 3, maxIter: 50, slicePoints: 256 });
  });

  it('mulberry32는 같은 시드에서 같은 수열을 낸다(0 이상 1 미만)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('설계 벡터 4축 × 8 → 같은 축 = 같은 묶음, 축이 다르면 다른 묶음', () => {
    const { vectors, labels } = designed(4, 8);
    const r = sphericalKMeansSync(vectors, 4);
    expect(r.centroids).toHaveLength(4);
    const groupToCluster = new Map<number, number>();
    labels.forEach((g, i) => {
      const c = r.assignments[i];
      if (!groupToCluster.has(g)) groupToCluster.set(g, c);
      expect(c).toBe(groupToCluster.get(g));
    });
    expect(new Set(groupToCluster.values()).size).toBe(4);
    for (const s of r.similarities) expect(s).toBeGreaterThan(0.95);
  });

  it('결정론: 같은 입력을 2회 돌리면 배정·관성이 완전히 같다', () => {
    const { vectors } = designed(5, 12, 24, 0.6); // 잡음을 크게 해 초기화 의존이 큰 데이터
    const a = sphericalKMeansSync(vectors, 5);
    const b = sphericalKMeansSync(vectors, 5);
    expect(Array.from(a.assignments)).toEqual(Array.from(b.assignments));
    expect(a.inertia).toBe(b.inertia);
    expect(a.iterations).toBe(b.iterations);
    expect(a.run).toBe(b.run);
  });

  it('동기 판과 비동기 판의 결과가 같다', async () => {
    const { vectors } = designed(5, 12, 24, 0.6);
    const sync = sphericalKMeansSync(vectors, 5);
    const asyncRes = await sphericalKMeans(vectors, 5, { yieldEvery: async () => undefined });
    expect(Array.from(asyncRes.assignments)).toEqual(Array.from(sync.assignments));
    expect(asyncRes.inertia).toBe(sync.inertia);
    expect(asyncRes.centroids.map((c) => Array.from(c))).toEqual(sync.centroids.map((c) => Array.from(c)));
  });

  it('조각: 256점마다 yieldEvery가 호출된다(점이 256 미만이면 0회)', async () => {
    let calls = 0;
    const yieldEvery = async () => {
      calls += 1;
    };
    await sphericalKMeans(designed(2, 100).vectors, 2, { yieldEvery }); // 200점 < 256
    expect(calls).toBe(0);

    calls = 0;
    await sphericalKMeans(designed(3, 200).vectors, 3, { yieldEvery }); // 600점 → 패스마다 2회
    expect(calls).toBeGreaterThanOrEqual(2 * CLUSTERING_ALGORITHM.nInit);
    expect(calls % 2).toBe(0);
  });

  it('slicePoints 옵션: 지정하면 양보 횟수가 늘고, 값이 달라도 결과는 완전히 같다', async () => {
    const { vectors } = designed(4, 40, 24, 0.6); // 160점
    const run = async (slicePoints?: number) => {
      let calls = 0;
      const res = await sphericalKMeans(vectors, 4, { slicePoints, yieldEvery: async () => void calls++ });
      return { res, calls };
    };
    const def = await run(); // 기본 256 > 160점 → 양보 0회
    const s32 = await run(32);
    const s7 = await run(7);
    expect(def.calls).toBe(0);
    expect(s32.calls).toBeGreaterThan(0);
    expect(s7.calls).toBeGreaterThan(s32.calls);
    for (const other of [s32.res, s7.res]) {
      expect(Array.from(other.assignments)).toEqual(Array.from(def.res.assignments));
      expect(other.inertia).toBe(def.res.inertia);
      expect(other.centroids.map((c) => Array.from(c))).toEqual(def.res.centroids.map((c) => Array.from(c)));
    }
    // 잘못된 값(0·음수·NaN)은 기본값으로 대체된다
    expect((await run(0)).calls).toBe(0);
    expect((await run(Number.NaN)).calls).toBe(0);
  });

  it('취소: isCancelled가 참이면 ClusteringCancelledError(동기·비동기 모두)', async () => {
    const { vectors } = designed(3, 10);
    expect(() => sphericalKMeansSync(vectors, 3, { isCancelled: () => true })).toThrow(ClusteringCancelledError);
    await expect(sphericalKMeans(vectors, 3, { isCancelled: () => true })).rejects.toThrow(ClusteringCancelledError);
  });

  it('전부 같은 벡터(EX-DC-3): 실제 묶음이 1개로 줄어든다', () => {
    const v = new Float32Array(8);
    v[2] = 1;
    const vectors = Array.from({ length: 6 }, () => Float32Array.from(v));
    const r = sphericalKMeansSync(vectors, 4);
    expect(r.centroids).toHaveLength(1);
    expect(Array.from(r.assignments)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.inertia).toBeCloseTo(0, 6);
  });

  it('k가 점 수보다 크면 점 수로 줄이고, 빈 묶음 없이 번호가 연속이다', () => {
    const { vectors } = designed(2, 2, 8);
    const r = sphericalKMeansSync(vectors, 50);
    expect(r.centroids.length).toBeLessThanOrEqual(4);
    const ids = new Set(r.assignments);
    expect(ids.size).toBe(r.centroids.length);
    for (let c = 0; c < r.centroids.length; c++) expect(ids.has(c)).toBe(true);
  });

  it('빈 입력 = 빈 결과, k=1이면 모두 묶음 0', () => {
    expect(sphericalKMeansSync([], 3).assignments).toHaveLength(0);
    const r = sphericalKMeansSync(designed(2, 3).vectors, 1);
    expect(Array.from(r.assignments)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('입력 벡터를 다시 정규화한다 — 크기만 다른 벡터는 같은 묶음, 0벡터도 죽지 않는다', () => {
    const a = Float32Array.from([1, 0, 0, 0]);
    const b = Float32Array.from([5, 0, 0, 0]);
    const c = Float32Array.from([0, 3, 0, 0]);
    const d = Float32Array.from([0, 9, 0, 0]);
    const zero = new Float32Array(4);
    const r = sphericalKMeansSync([a, b, c, d, zero], 2);
    expect(r.assignments[0]).toBe(r.assignments[1]);
    expect(r.assignments[2]).toBe(r.assignments[3]);
    expect(r.assignments[0]).not.toBe(r.assignments[2]);
    expect(r.similarities[4]).toBe(0);
    expect(r.similarities[1]).toBeCloseTo(1, 6);
  });

  it('동점 규칙: 두 중심과 똑같이 가까운 점은 작은 중심 인덱스로 간다(입력 순서가 같으면 항상 같은 결과)', () => {
    const e0 = Float32Array.from([1, 0, 0]);
    const e1 = Float32Array.from([0, 1, 0]);
    const mid = Float32Array.from([1, 1, 0]);
    const first = sphericalKMeansSync([e0, e1, mid], 2);
    const second = sphericalKMeansSync([e0, e1, mid], 2);
    expect(Array.from(first.assignments)).toEqual(Array.from(second.assignments));
    // 중간 점은 (e0)·(e1) 어느 쪽과도 같은 유사도가 아니게 중심이 갱신되지만, 결과는 재현된다.
    expect(first.centroids).toHaveLength(2);
  });

  it('유사도 = 배정 중심과의 내적, 관성 = Σ(1 - 유사도)', () => {
    const { vectors } = designed(3, 6, 12, 0.3);
    const r = sphericalKMeansSync(vectors, 3);
    let inertia = 0;
    for (let i = 0; i < vectors.length; i++) {
      let dot = 0;
      let nv = 0;
      for (let d = 0; d < vectors[i].length; d++) {
        dot += vectors[i][d] * r.centroids[r.assignments[i]][d];
        nv += vectors[i][d] * vectors[i][d];
      }
      dot /= Math.sqrt(nv);
      expect(r.similarities[i]).toBeCloseTo(dot, 4);
      inertia += 1 - r.similarities[i];
    }
    expect(r.inertia).toBeCloseTo(inertia, 4);
  });
});
