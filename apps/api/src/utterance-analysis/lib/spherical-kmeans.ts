/**
 * 구면 k-평균(No.21 발화 묶음 분석 — 설계서 §5.3, ADR-0047). L2 정규화 벡터 위에서 코사인(내적) 최대 중심에
 * 배정하는 k-평균이며, **군집 교체 지점 1곳(NFR-DCM1)** 이다. DB·Nest·Prisma 무의존 순수 함수다.
 *
 * 결정론 규약(FR-DC3-5): 같은 입력 벡터(비트 동일)·같은 k·같은 상수 → 같은 배정.
 *  - 난수는 `mulberry32(seed + run)`만 쓴다(`Math.random` 금지 — UA-10).
 *  - 배정 동점은 작은 중심 인덱스, 관성 동점은 작은 run.
 *  - 중심 갱신 합산은 `Float64Array` 누산 · 점 인덱스 오름차순으로 고정한다.
 *  - 호출부가 입력을 정규화 문자열 오름차순으로 정렬해 넘긴다(파일 행 순서 무관).
 *
 * 비동기 판(`sphericalKMeans`)과 동기 판(`sphericalKMeansSync`)은 **같은 제너레이터 본체**를 구동한다 —
 * 둘의 결과가 같다는 것을 구조로 보장하고, 시험이 다시 단언한다. 비동기 판은 `slicePoints`점마다
 * `hooks.yieldEvery()`를 기다려 API 이벤트 루프를 양보한다(대화 경로 보호 — NFR-DCP).
 */

/** 알고리즘 상수 1곳 — 값이나 규칙을 바꾸면 `version`을 올린다(분석 행 `algorithmVersion`에 기록). */
export const CLUSTERING_ALGORITHM = {
  version: 'skmeans-1',
  seed: 20260930,
  nInit: 3,
  maxIter: 50,
  slicePoints: 256,
} as const;

export interface SphericalKMeansHooks {
  /** 비동기 판 전용: 조각(slicePoints점)마다 호출된다 — 러너가 `setImmediate`를 주입한다. */
  yieldEvery?: () => Promise<void>;
  /** 반복마다(그리고 조각 경계마다) 확인한다. 참이면 `ClusteringCancelledError`. */
  isCancelled?: () => boolean;
  /** 양보 간격(점 수). 미지정 = `CLUSTERING_ALGORITHM.slicePoints`(256). 결과에는 영향이 없다(1 이상 정수). */
  slicePoints?: number;
}

export interface SphericalKMeansResult {
  /** 발화별 묶음 번호(0..centroids.length-1, 빈 묶음은 제거되어 연속). */
  assignments: Int32Array;
  /** 정규화된 중심(실제 묶음 수 = 길이). 요청 k보다 짧을 수 있다(전부 같은 문장 · 빈 묶음). */
  centroids: Float32Array[];
  /** 발화별 배정 중심과의 코사인. */
  similarities: Float32Array;
  iterations: number;
  /** Σ(1 − cos). */
  inertia: number;
  /** 선택된 run(0-기반). */
  run: number;
}

export class ClusteringCancelledError extends Error {
  constructor() {
    super('군집 계산이 취소되었습니다');
    this.name = 'ClusteringCancelledError';
  }
}

/** 32비트 시드 난수(결정론). 0 이상 1 미만. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function l2Normalized(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const out = new Float32Array(v.length);
  if (s === 0) return out; // 0벡터는 그대로(유사도 0으로 취급)
  const inv = 1 / Math.sqrt(s);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 제너레이터가 양보 신호로 내보내는 값(비동기 판이 이 지점에서 await 한다). */
type YieldSignal = 'slice';

interface RunOutcome {
  assignments: Int32Array;
  centroids: Float32Array[];
  iterations: number;
}

function* initCentroids(
  points: readonly Float32Array[],
  k: number,
  rng: () => number,
  slice: number,
  checkCancel: () => void,
): Generator<YieldSignal, Float32Array[]> {
  const n = points.length;
  const centroids: Float32Array[] = [];
  const first = Math.min(n - 1, Math.floor(rng() * n));
  centroids.push(Float32Array.from(points[first]));
  // maxSim[i] = 지금까지 뽑은 중심과의 최대 코사인
  const maxSim = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    maxSim[i] = dot(points[i], centroids[0]);
    if ((i + 1) % slice === 0) {
      checkCancel();
      yield 'slice';
    }
  }
  const weights = new Float64Array(n);
  while (centroids.length < k) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = 1 - maxSim[i];
      weights[i] = d > 0 ? d : 0;
      total += weights[i];
    }
    // 모든 D가 0(전부 같은 문장 — EX-DC-3) 이면 남은 중심을 만들지 않는다.
    if (!(total > 1e-12)) break;
    const r = rng() * total;
    let acc = 0;
    let pick = -1;
    let lastPositive = -1;
    for (let i = 0; i < n; i++) {
      if (weights[i] <= 0) continue;
      lastPositive = i;
      acc += weights[i];
      if (acc > r) {
        pick = i;
        break;
      }
    }
    if (pick < 0) pick = lastPositive;
    if (pick < 0) break;
    const c = Float32Array.from(points[pick]);
    centroids.push(c);
    for (let i = 0; i < n; i++) {
      const s = dot(points[i], c);
      if (s > maxSim[i]) maxSim[i] = s;
      if ((i + 1) % slice === 0) {
        checkCancel();
        yield 'slice';
      }
    }
  }
  return centroids;
}

function* singleRun(
  points: readonly Float32Array[],
  k: number,
  seed: number,
  maxIter: number,
  slice: number,
  checkCancel: () => void,
): Generator<YieldSignal, RunOutcome> {
  const n = points.length;
  const dim = points[0].length;
  const rng = mulberry32(seed);
  const centroids = yield* initCentroids(points, k, rng, slice, checkCancel);
  const kk = centroids.length;
  const assignments = new Int32Array(n).fill(-1);
  const sims = new Float64Array(n);
  const counts = new Int32Array(kk);
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    checkCancel();
    iterations = iter + 1;
    let changed = false;
    counts.fill(0);
    // 배정 — 동점은 작은 중심 인덱스(엄격 부등호)
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = dot(points[i], centroids[0]);
      for (let c = 1; c < kk; c++) {
        const s = dot(points[i], centroids[c]);
        if (s > bestSim) {
          bestSim = s;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
      sims[i] = bestSim;
      counts[best]++;
      if ((i + 1) % slice === 0) {
        checkCancel();
        yield 'slice';
      }
    }
    // 빈 묶음 — 배정 유사도가 가장 낮은 점(동점 = 작은 인덱스)을 다시 심는다. 원래 묶음의 유일한 점이면 심지 않는다.
    for (let c = 0; c < kk; c++) {
      if (counts[c] > 0) continue;
      let pick = -1;
      let pickSim = Infinity;
      for (let i = 0; i < n; i++) {
        if (counts[assignments[i]] <= 1) continue;
        if (sims[i] < pickSim) {
          pickSim = sims[i];
          pick = i;
        }
      }
      if (pick < 0) continue;
      counts[assignments[pick]]--;
      assignments[pick] = c;
      counts[c] = 1;
      sims[pick] = 1;
      centroids[c] = Float32Array.from(points[pick]);
      changed = true;
    }
    if (!changed) break;
    // 갱신 — 배정 점의 합(Float64 누산 · 점 인덱스 오름차순)을 L2 정규화
    const sums: Float64Array[] = [];
    for (let c = 0; c < kk; c++) sums.push(new Float64Array(dim));
    for (let i = 0; i < n; i++) {
      const s = sums[assignments[i]];
      const p = points[i];
      for (let d = 0; d < dim; d++) s[d] += p[d];
      if ((i + 1) % slice === 0) {
        checkCancel();
        yield 'slice';
      }
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c] === 0) continue; // 빈 채로 남은 묶음은 이전 중심 유지(마지막에 버린다)
      const s = sums[c];
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += s[d] * s[d];
      if (!(norm > 0)) continue; // 상쇄되어 0이면 이전 중심 유지
      const inv = 1 / Math.sqrt(norm);
      const out = new Float32Array(dim);
      for (let d = 0; d < dim; d++) out[d] = s[d] * inv;
      centroids[c] = out;
    }
  }
  return { assignments, centroids, iterations };
}

function* kmeansCore(
  input: readonly Float32Array[],
  kRequested: number,
  hooks: SphericalKMeansHooks,
): Generator<YieldSignal, SphericalKMeansResult> {
  const n = input.length;
  if (n === 0) {
    return { assignments: new Int32Array(0), centroids: [], similarities: new Float32Array(0), iterations: 0, inertia: 0, run: 0 };
  }
  const { seed, nInit, maxIter } = CLUSTERING_ALGORITHM;
  const requested = hooks.slicePoints;
  const slicePoints = requested !== undefined && Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : CLUSTERING_ALGORITHM.slicePoints;
  const checkCancel = () => {
    if (hooks.isCancelled?.()) throw new ClusteringCancelledError();
  };
  const points = input.map(l2Normalized);
  const k = Math.max(1, Math.min(Math.floor(kRequested), n));

  let best: (RunOutcome & { inertia: number; run: number }) | null = null;
  for (let run = 0; run < nInit; run++) {
    const outcome = yield* singleRun(points, k, seed + run, maxIter, slicePoints, checkCancel);
    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += 1 - dot(points[i], outcome.centroids[outcome.assignments[i]]);
    if (best === null || inertia < best.inertia) best = { ...outcome, inertia, run };
  }
  const chosen = best!;

  // 빈 묶음 제거 + 번호 연속화(원래 상대 순서 유지)
  const usedSet = new Set<number>();
  for (let i = 0; i < n; i++) usedSet.add(chosen.assignments[i]);
  const usedSorted = [...usedSet].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  const centroids: Float32Array[] = [];
  usedSorted.forEach((old, idx) => {
    remap.set(old, idx);
    centroids.push(chosen.centroids[old]);
  });
  const assignments = new Int32Array(n);
  const similarities = new Float32Array(n);
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    const c = remap.get(chosen.assignments[i])!;
    assignments[i] = c;
    const s = dot(points[i], centroids[c]);
    similarities[i] = s;
    inertia += 1 - s;
  }
  return { assignments, centroids, similarities, iterations: chosen.iterations, inertia, run: chosen.run };
}

/** 동기 판(단위 시험·품질 측정 도구용) — 양보 없음. 결과는 비동기 판과 같다. */
export function sphericalKMeansSync(
  vectors: readonly Float32Array[],
  k: number,
  hooks: Pick<SphericalKMeansHooks, 'isCancelled'> = {},
): SphericalKMeansResult {
  const gen = kmeansCore(vectors, k, hooks);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
  }
}

/** 비동기 판(러너용) — `slicePoints`점마다 `hooks.yieldEvery()`를 기다린다. */
export async function sphericalKMeans(
  vectors: readonly Float32Array[],
  k: number,
  hooks: SphericalKMeansHooks = {},
): Promise<SphericalKMeansResult> {
  const gen = kmeansCore(vectors, k, hooks);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
    if (hooks.yieldEvery) await hooks.yieldEvery();
  }
}
