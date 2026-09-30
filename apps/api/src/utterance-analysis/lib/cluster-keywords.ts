import { compareCodeUnit } from './cluster-postprocess';

/**
 * 묶음 대표 키워드 점수(No.21 — 설계서 §6.2, c-TF-IDF 변형). DB·Nest 무의존 순수 함수.
 *
 *   score(t, c) = (tf(t, c) / |c|) × ln(1 + A / f(t))
 *
 * - `tf(t, c)` = 묶음 c에서 t가 나온 **고유 발화 수** · `|c|` = 묶음 c의 고유 발화 수
 * - `f(t)` = 전체(미분류 포함)에서 t가 나온 고유 발화 수 · `A` = 묶음(미분류 포함)당 평균 고유 발화 수
 * - 후보 조건 `tf ≥ 2`(묶음 발화가 4개 미만이면 1) — 한 문장에만 나온 단어가 키워드가 되지 않게
 * - 정렬 = 점수 ↓ → tf ↓ → 용어 코드 유닛 순(결정론). **발생 횟수는 쓰지 않는다**(R-19).
 */

export interface ClusterKeyword {
  readonly term: string;
  /** 소수 4자리로 반올림. */
  readonly score: number;
  /** = tf(t, c). */
  readonly count: number;
}

/** 묶음 하나의 입력 — `docs[i]`는 고유 발화 i의 키워드 후보(발화 안 중복 없음). */
export interface KeywordClusterInput {
  readonly docs: readonly (readonly string[])[];
}

const MIN_TF = 2;
const SMALL_CLUSTER = 4;

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** 입력 묶음(미분류 포함) 순서대로 상위 `keywordCount`개 키워드를 돌려준다. */
export function computeClusterKeywords(clusters: readonly KeywordClusterInput[], keywordCount: number): ClusterKeyword[][] {
  const limit = Math.max(0, Math.floor(keywordCount));
  const totalDocs = clusters.reduce((s, c) => s + c.docs.length, 0);
  const avg = clusters.length > 0 ? totalDocs / clusters.length : 0;

  // f(t) — 전체에서 t가 나온 고유 발화 수
  const df = new Map<string, number>();
  for (const c of clusters) {
    for (const doc of c.docs) {
      for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  return clusters.map((c) => {
    const size = c.docs.length;
    if (size === 0 || limit === 0) return [];
    const tf = new Map<string, number>();
    for (const doc of c.docs) {
      for (const t of new Set(doc)) tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    const minTf = size < SMALL_CLUSTER ? 1 : MIN_TF;
    const scored: ClusterKeyword[] = [];
    for (const [term, count] of tf) {
      if (count < minTf) continue;
      const score = round4((count / size) * Math.log(1 + avg / df.get(term)!));
      scored.push({ term, score, count });
    }
    scored.sort((a, b) => b.score - a.score || b.count - a.count || compareCodeUnit(a.term, b.term));
    return scored.slice(0, limit);
  });
}

/** 자동 이름(FR-DC4-3): 상위 키워드 3개를 " · "로 연결. 키워드 0개 = `묶음 {ordinal}`, 미분류 = `미분류`. */
export function autoClusterName(keywords: readonly ClusterKeyword[], ordinal: number, unassigned: boolean): string {
  if (unassigned) return '미분류';
  if (keywords.length === 0) return `묶음 ${ordinal}`;
  return keywords
    .slice(0, 3)
    .map((k) => k.term)
    .join(' · ');
}
