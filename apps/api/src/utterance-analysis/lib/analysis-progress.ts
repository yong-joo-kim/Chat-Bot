import type { UtteranceAnalysisStage } from '@chat-bot/shared-types';

/**
 * 단계 → 진행률(No.21 — 설계서 §8.1). 임베딩 0→60 · 묶기 60→75 · 키워드 75→80 · 대조 80→95(끔이면 그 구간은
 * 이름 제안에) · 이름 제안 95→99 · 저장 100. DB·Nest 무의존 순수 함수.
 */

export interface ProgressPlan {
  readonly probe: boolean;
  readonly nameSuggest: boolean;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

export function stageRange(stage: UtteranceAnalysisStage, plan: ProgressPlan): Range {
  switch (stage) {
    case 'EMBEDDING':
      return { from: 0, to: 60 };
    case 'CLUSTERING':
      return { from: 60, to: 75 };
    case 'KEYWORDS':
      return { from: 75, to: 80 };
    case 'PROBING':
      return { from: 80, to: 95 };
    case 'NAMING':
      // 대조를 끄면 80→95 구간을 이름 제안이 이어받는다.
      return plan.probe ? { from: 95, to: 99 } : { from: 80, to: 99 };
    case 'SAVING':
      return { from: 99, to: 100 };
  }
}

/** 단계 안의 진행 비율(0~1)을 전체 진행률(정수 0~100)로 바꾼다. */
export function progressOf(stage: UtteranceAnalysisStage, fraction: number, plan: ProgressPlan): number {
  const { from, to } = stageRange(stage, plan);
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(from + (to - from) * f);
}
