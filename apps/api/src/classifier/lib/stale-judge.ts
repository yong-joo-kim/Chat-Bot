/**
 * No.23 (B) 경량 분류기 stale 판정(ADR-0027 §6, 설계서 §12.3) — DB·Nest 무의존 순수 함수.
 * 3조건 중 `MODEL_CHANGED`만 "즉시 사용 중지"(disabled)이고 나머지 둘은 "경고만"(계속 사용)이다.
 */
export type ClassifierStaleReason = 'MODEL_CHANGED' | 'INTENTS_DRIFTED' | 'EXAMPLES_DRIFTED';

export interface StaleJudgeInput {
  readonly trainedModelId: string;
  readonly currentModelId: string | undefined;
  /** 학습 시점의 챗봇 전체 의도 수(기준선). */
  readonly intentCountAtTrain: number;
  /** 현재 챗봇 전체 의도 수. */
  readonly currentIntentCount: number;
  /** 학습 시점의 챗봇 전체 예문 총량(기준선). */
  readonly exampleCountAtTrain: number;
  /** 현재 챗봇 전체 예문 총량. */
  readonly currentExampleCount: number;
}

export interface StaleJudgeResult {
  readonly stale: boolean;
  readonly reasons: readonly ClassifierStaleReason[];
  /** true면 추천이 즉시 LEXICAL(bigram)로 자동 복귀해야 한다 — 정확도 문제가 아니라 입력 공간이 다르다. */
  readonly disabled: boolean;
}

/** 의도 집합 변경 판정 임계(10%, FR-L2-21 ②). */
const INTENT_DRIFT_RATIO = 0.1;
/** 예문 누적 변경 판정 임계(50건 초과, FR-L2-21 ③). */
const EXAMPLE_DRIFT_ABSOLUTE = 50;

export function judgeClassifierStale(input: StaleJudgeInput): StaleJudgeResult {
  const reasons: ClassifierStaleReason[] = [];

  const modelChanged = input.currentModelId === undefined || input.trainedModelId !== input.currentModelId;
  if (modelChanged) reasons.push('MODEL_CHANGED');

  if (input.intentCountAtTrain > 0) {
    const delta = Math.abs(input.currentIntentCount - input.intentCountAtTrain) / input.intentCountAtTrain;
    if (delta >= INTENT_DRIFT_RATIO) reasons.push('INTENTS_DRIFTED');
  }

  if (input.currentExampleCount - input.exampleCountAtTrain > EXAMPLE_DRIFT_ABSOLUTE) {
    reasons.push('EXAMPLES_DRIFTED');
  }

  return { stale: reasons.length > 0, reasons, disabled: modelChanged };
}
