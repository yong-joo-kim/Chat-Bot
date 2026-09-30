/**
 * 군집 결과 후처리(No.21 — 설계서 §5.4). 실제 묶음 수 결정 · 최소 크기 미만 묶음의 "미분류" 처리 · 묶음 번호 ·
 * 대표 발화 · 발화 정렬 순번(`seq`)을 만든다. DB·Nest 무의존 순수 함수이며 **입력 순서와 무관하게 결정적**이다
 * (문자열 비교는 `localeCompare`가 아닌 코드 유닛 비교 — 로케일 무관).
 *
 * 입력 발화(`ClusterItem`)는 이미 정규화 문자열 기준으로 병합된 **고유 발화**다 — "발화 수"는 고유 문장 수이고
 * 발생 횟수(`count`)가 아니다(FR-DC3-3).
 */

export type ClusterNotice = 'TARGET_REDUCED' | 'FEWER_THAN_TARGET' | 'NO_CLUSTER';

export interface ClusterItem {
  /** `normalizeText(마스킹본)` — 정렬·동점 처리 키. */
  readonly normalized: string;
  /** 발생 횟수(≥1). */
  readonly count: number;
  /** 군집 함수가 돌려준 묶음 번호(0-기반). */
  readonly assignment: number;
  /** 배정 중심과의 코사인. */
  readonly similarity: number;
}

export interface ResolvedClusterCount {
  /** floor(n / minClusterSize). */
  readonly kMax: number;
  /** 사용할 k = min(target, kMax). `tooFew`이면 0. */
  readonly k: number;
  readonly reduced: boolean;
  /** kMax < 2 — 요청 단계에서 400 UTTERANCE_ANALYSIS_TOO_FEW로 거부된다(§7.4). */
  readonly tooFew: boolean;
}

/** §5.4-1 실제 k. */
export function resolveClusterCount(uniqueCount: number, minClusterSize: number, targetClusterCount: number): ResolvedClusterCount {
  const min = Math.max(1, Math.floor(minClusterSize));
  const kMax = Math.floor(uniqueCount / min);
  if (kMax < 2) return { kMax, k: 0, reduced: false, tooFew: true };
  const k = Math.min(Math.max(1, Math.floor(targetClusterCount)), kMax);
  return { kMax, k, reduced: k < targetClusterCount, tooFew: false };
}

export interface ProcessedCluster {
  /** 1..m, 미분류는 m+1. */
  readonly ordinal: number;
  readonly unassigned: boolean;
  /** 고유 발화 수. */
  readonly uniqueCount: number;
  /** 발생 횟수 합. */
  readonly occurrenceSum: number;
  /** 입력 `items` 인덱스 — `seq` 순서(§5.4-7). */
  readonly itemIndexes: readonly number[];
  /** 대표 발화(최대 3개) 입력 `items` 인덱스 — 묶음 안 유사도 내림차순(미분류는 발생 횟수 내림차순). */
  readonly representativeIndexes: readonly number[];
}

export interface PostprocessResult {
  readonly clusters: readonly ProcessedCluster[];
  /** 묶음(미분류 제외) 개수 m. */
  readonly clusterCount: number;
  /** 입력 `items` 인덱스별 묶음 `ordinal`. */
  readonly ordinalByItem: Int32Array;
  /** 입력 `items` 인덱스별 정렬 순번(1..n 연속). */
  readonly seqByItem: Int32Array;
  /** `seq` 순서로 늘어놓은 입력 인덱스(페이지 조회용). */
  readonly itemOrder: readonly number[];
  readonly notices: readonly ClusterNotice[];
}

export interface PostprocessInput {
  readonly items: readonly ClusterItem[];
  readonly minClusterSize: number;
  /** 화면·요청이 낸 목표 묶음 수(알림 판정용). */
  readonly targetClusterCount: number;
  /** 군집에 실제 넘긴 k(`resolveClusterCount().k`). */
  readonly usedK: number;
}

const REPRESENTATIVE_COUNT = 3;

/** 코드 유닛 순서 비교(로케일 무관·결정론). */
export function compareCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bySimilarityDesc(items: readonly ClusterItem[]) {
  return (a: number, b: number): number => {
    const d = items[b].similarity - items[a].similarity;
    if (d !== 0) return d;
    return compareCodeUnit(items[a].normalized, items[b].normalized);
  };
}

function byCountDesc(items: readonly ClusterItem[]) {
  return (a: number, b: number): number => {
    const d = items[b].count - items[a].count;
    if (d !== 0) return d;
    return compareCodeUnit(items[a].normalized, items[b].normalized);
  };
}

export function postprocessClusters(input: PostprocessInput): PostprocessResult {
  const { items, minClusterSize, targetClusterCount, usedK } = input;
  const n = items.length;
  const notices: ClusterNotice[] = [];
  if (usedK < targetClusterCount) notices.push('TARGET_REDUCED');

  // ② 묶음별로 모은다(빈 묶음은 자연히 없음)
  const byAssignment = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const list = byAssignment.get(items[i].assignment);
    if (list) list.push(i);
    else byAssignment.set(items[i].assignment, [i]);
  }

  // ③ 최소 크기 미만은 전부 미분류 — 다시 배정하지 않는다
  const kept: number[][] = [];
  const unassignedIdx: number[] = [];
  for (const key of [...byAssignment.keys()].sort((a, b) => a - b)) {
    const members = byAssignment.get(key)!;
    if (members.length >= minClusterSize) kept.push(members);
    else unassignedIdx.push(...members);
  }

  // ⑥ 묶음 안 정렬 · 대표 발화
  const simSort = bySimilarityDesc(items);
  const prepared = kept.map((members) => {
    const sorted = [...members].sort(simSort);
    let occ = 0;
    for (const i of members) occ += items[i].count;
    return { sorted, uniqueCount: members.length, occurrenceSum: occ };
  });

  // ④ 번호: 고유 발화 수 ↓ → 발생 횟수 합 ↓ → 대표 발화 정규화 문자열 ↑
  prepared.sort((a, b) => {
    if (b.uniqueCount !== a.uniqueCount) return b.uniqueCount - a.uniqueCount;
    if (b.occurrenceSum !== a.occurrenceSum) return b.occurrenceSum - a.occurrenceSum;
    return compareCodeUnit(items[a.sorted[0]].normalized, items[b.sorted[0]].normalized);
  });

  const clusters: ProcessedCluster[] = prepared.map((p, idx) => ({
    ordinal: idx + 1,
    unassigned: false,
    uniqueCount: p.uniqueCount,
    occurrenceSum: p.occurrenceSum,
    itemIndexes: p.sorted,
    representativeIndexes: p.sorted.slice(0, REPRESENTATIVE_COUNT),
  }));
  const m = clusters.length;

  if (unassignedIdx.length > 0) {
    const sorted = [...unassignedIdx].sort(byCountDesc(items));
    let occ = 0;
    for (const i of sorted) occ += items[i].count;
    clusters.push({
      ordinal: m + 1,
      unassigned: true,
      uniqueCount: sorted.length,
      occurrenceSum: occ,
      itemIndexes: sorted,
      representativeIndexes: sorted.slice(0, REPRESENTATIVE_COUNT),
    });
  }

  // ⑤ 알림 — m = 0이면 NO_CLUSTER만(전부 미분류 · 분석은 성공)
  if (m === 0) notices.push('NO_CLUSTER');
  else if (m < usedK) notices.push('FEWER_THAN_TARGET');

  // ⑦ seq
  const ordinalByItem = new Int32Array(n);
  const seqByItem = new Int32Array(n);
  const itemOrder: number[] = [];
  for (const c of clusters) {
    for (const i of c.itemIndexes) {
      ordinalByItem[i] = c.ordinal;
      itemOrder.push(i);
      seqByItem[i] = itemOrder.length;
    }
  }

  return { clusters, clusterCount: m, ordinalByItem, seqByItem, itemOrder, notices };
}
