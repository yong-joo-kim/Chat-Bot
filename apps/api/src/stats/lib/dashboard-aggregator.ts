import type { VisitCountBasis } from '@chat-bot/shared-types';

/**
 * 정규화 병합으로 순위가 바뀔 여지를 남기면서도 응답을 예측 가능하게 유지하는 후보 상한(ADR-0004).
 * No.14 신규 질문순위(`aggregateTopQuestions` 재사용)도 이 상수를 그대로 쓴다(DD-58) — 두 벌로
 * 만들지 않는다. `stats.service.ts`의 기존 `getDashboard()` 로컬 상수는 그대로 유지한다(무회귀).
 */
export const TOP_QUESTION_CANDIDATE_LIMIT = 500;

export interface TopQuestionRow {
  question: string;
  count: number;
  lastOccurredAt: Date;
}

export interface TopQuestionResult {
  question: string;
  count: number;
}

function normalizeQuestion(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * 인기질문 정규화·병합·정렬(FR-2-4, AC-2-2~AC-2-4, EX-2-3, ADR-0004).
 * 정규화: trim + 연속 공백 1칸 축약. 빈 문자열은 제외(분모에는 포함되지만 이 함수의 관심사가 아니다).
 * 정렬: count desc → 동률 시 lastOccurredAt desc. 순수 함수 — 단위 테스트 1차 타깃(NFR-M3).
 */
export function aggregateTopQuestions(rows: TopQuestionRow[], topN: number): TopQuestionResult[] {
  const merged = new Map<string, { count: number; lastOccurredAt: number }>();

  for (const row of rows) {
    const normalized = normalizeQuestion(row.question);
    if (normalized.length === 0) continue;

    const lastOccurredAt = row.lastOccurredAt.getTime();
    const existing = merged.get(normalized);
    if (existing) {
      existing.count += row.count;
      existing.lastOccurredAt = Math.max(existing.lastOccurredAt, lastOccurredAt);
    } else {
      merged.set(normalized, { count: row.count, lastOccurredAt });
    }
  }

  return Array.from(merged.entries())
    .map(([question, v]) => ({ question, count: v.count, lastOccurredAt: v.lastOccurredAt }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : b.lastOccurredAt - a.lastOccurredAt))
    .slice(0, topN)
    .map(({ question, count }) => ({ question, count }));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface ResponseRateInput {
  answeredCount: number;
  totalCount: number;
}

export interface ResponseRateResult {
  responseRate: number;
  noResponseRate: number;
}

/**
 * 응답률/미응답률 계산(FR-2-2, FR-2-3, FR-2-9, AC-2-1).
 * `noResponseRate`는 반올림된 `responseRate`로부터 파생해 합이 항상 정확히 1이 되게 한다.
 * `totalCount === 0`이면 두 값 모두 0(0으로 나누기/NaN 금지).
 */
export function computeResponseRates({ answeredCount, totalCount }: ResponseRateInput): ResponseRateResult {
  if (totalCount === 0) return { responseRate: 0, noResponseRate: 0 };
  const responseRate = round4(answeredCount / totalCount);
  return { responseRate, noResponseRate: round4(1 - responseRate) };
}

export interface VisitCountInput {
  distinctSessionCount: number;
  nullSessionCount: number;
}

export interface VisitCountResult {
  visitCount: number;
  visitCountBasis: VisitCountBasis;
}

/**
 * 접속수 산정(ADR-0001). `sessionId` 보유 로그가 기간 내 하나라도 있으면 'SESSION',
 * 전혀 없으면(즉 순수 로그 건수와 동일) 'LOG_COUNT'.
 */
export function computeVisitCount({ distinctSessionCount, nullSessionCount }: VisitCountInput): VisitCountResult {
  return {
    visitCount: distinctSessionCount + nullSessionCount,
    visitCountBasis: distinctSessionCount > 0 ? 'SESSION' : 'LOG_COUNT',
  };
}
