import type { TestCaseResultKind, TestRunComparisonKind } from '@chat-bot/shared-types';

/**
 * M1(실행 간 비교) 5분류 순수 함수(FR-V2-6, ADR-0029 §2) — 저장하지 않고 조회 시점에 계산한다.
 * DB·Nest 무의존. `caseId` 기준으로 두 실행의 결과 행을 매칭한다.
 */
export interface ComparableResult {
  caseId: string;
  questionText: string;
  result: TestCaseResultKind;
  matchedIntentId: string | null;
  matchedFaqId: string | null;
  matchedNodeId: string | null;
  outputsHash: string;
}

export interface ComparisonRow {
  caseId: string;
  questionText: string | null;
  classification: TestRunComparisonKind;
  base: ComparableResult | null;
  target: ComparableResult | null;
}

function sideOf(r: ComparableResult) {
  return { result: r.result, matchedIntentId: r.matchedIntentId, matchedFaqId: r.matchedFaqId, matchedNodeId: r.matchedNodeId, outputsHash: r.outputsHash };
}

function classify(base: ComparableResult, target: ComparableResult): TestRunComparisonKind {
  if (base.result === 'PASS' && target.result === 'FAIL') return 'REGRESSED';
  if (base.result === 'FAIL' && target.result === 'PASS') return 'IMPROVED';

  const matchedSame =
    base.matchedIntentId === target.matchedIntentId && base.matchedFaqId === target.matchedFaqId && base.matchedNodeId === target.matchedNodeId;
  const hashSame = base.outputsHash === target.outputsHash;
  if (base.result === target.result && matchedSame && hashSame) return 'UNCHANGED';
  return 'CHANGED';
}

export function compareRuns(baseResults: readonly ComparableResult[], targetResults: readonly ComparableResult[]): ComparisonRow[] {
  const baseByCase = new Map(baseResults.map((r) => [r.caseId, r] as const));
  const targetByCase = new Map(targetResults.map((r) => [r.caseId, r] as const));
  const allCaseIds = new Set([...baseByCase.keys(), ...targetByCase.keys()]);

  const rows: ComparisonRow[] = [];
  for (const caseId of allCaseIds) {
    const base = baseByCase.get(caseId) ?? null;
    const target = targetByCase.get(caseId) ?? null;
    const questionText = target?.questionText ?? base?.questionText ?? null;

    if (!base || !target) {
      rows.push({ caseId, questionText, classification: 'ONLY_IN_ONE', base: base ? sideOf(base) as ComparableResult : null, target: target ? (sideOf(target) as ComparableResult) : null });
      continue;
    }
    rows.push({ caseId, questionText, classification: classify(base, target), base: sideOf(base) as ComparableResult, target: sideOf(target) as ComparableResult });
  }
  return rows;
}

/** 정렬·집계 헬퍼 — REGRESSED 우선 정렬(FR-V2-6). */
const CLASSIFICATION_ORDER: Record<TestRunComparisonKind, number> = {
  REGRESSED: 0,
  IMPROVED: 1,
  CHANGED: 2,
  ONLY_IN_ONE: 3,
  UNCHANGED: 4,
};

export function sortComparisonRows(rows: ComparisonRow[]): ComparisonRow[] {
  return [...rows].sort((a, b) => CLASSIFICATION_ORDER[a.classification] - CLASSIFICATION_ORDER[b.classification]);
}

export function countByClassification(rows: readonly ComparisonRow[]): Record<TestRunComparisonKind, number> {
  const counts: Record<TestRunComparisonKind, number> = { REGRESSED: 0, IMPROVED: 0, CHANGED: 0, UNCHANGED: 0, ONLY_IN_ONE: 0 };
  for (const row of rows) counts[row.classification] += 1;
  return counts;
}
