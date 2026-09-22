/**
 * No.23 (B) 경량 의도 분류기 — 저장된 문장 임베딩 위의 다항 로지스틱 회귀(ADR-0027 §1, DD-106).
 * 입력이 이미 L2 정규화된 벡터이므로(ADR-0024 §1) 선형 모델로 충분하다. DB·Nest·외부 ML 라이브러리
 * 무의존 순수 함수 — CPU 수 초 안에 끝나는 소규모 문제에 맞춘 미니배치 경사하강법이다.
 *
 * **결정론 규약**(ADR-0027 §1 — 같은 입력 → 같은 모델): 샘플 순서는 호출부가 고정해 전달하고 이
 * 함수는 셔플하지 않는다 · 가중치 초기값은 항상 0 · `maxEpochs` 상한 고정 · `tolerance` 기반 수렴
 * 판정 · 난수 미사용.
 */

export interface LogisticRegressionSample {
  readonly vector: Float32Array;
  readonly classIndex: number;
}

export interface TrainMultinomialLogisticInput {
  readonly samples: readonly LogisticRegressionSample[];
  readonly classCount: number;
  readonly dimension: number;
  readonly l2?: number;
  readonly learningRate?: number;
  readonly maxEpochs?: number;
  readonly batchSize?: number;
  readonly tolerance?: number;
  /** 클래스 불균형 보정(EX-L2-9). 인덱스 = classIndex. 미지정 시 전부 1(가중치 없음). */
  readonly classWeights?: readonly number[];
}

export interface TrainMultinomialLogisticResult {
  /** [classCount × dimension] row-major — weights[c*dimension+d]. */
  readonly weights: Float32Array;
  readonly bias: Float32Array;
  readonly epochs: number;
  readonly finalLoss: number;
}

function logitsFor(
  vector: Float32Array,
  weights: Float64Array,
  bias: Float64Array,
  classCount: number,
  dimension: number,
): Float64Array {
  const logits = new Float64Array(classCount);
  for (let c = 0; c < classCount; c++) {
    let sum = bias[c];
    const offset = c * dimension;
    for (let d = 0; d < dimension; d++) sum += weights[offset + d] * vector[d];
    logits[c] = sum;
  }
  return logits;
}

function softmaxInto(logits: Float64Array, out: Float64Array): void {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  if (sum === 0) {
    out.fill(1 / logits.length);
    return;
  }
  for (let i = 0; i < logits.length; i++) out[i] /= sum;
}

/**
 * 전체 데이터셋에 대한 평균 교차엔트로피 + L2 페널티(수렴 판정·관측용, EX-L2-* 대비 결정론적 로그).
 */
function computeLoss(
  samples: readonly LogisticRegressionSample[],
  weights: Float64Array,
  bias: Float64Array,
  classCount: number,
  dimension: number,
  l2: number,
  classWeights: readonly number[],
): number {
  const probs = new Float64Array(classCount);
  let loss = 0;
  for (const sample of samples) {
    const logits = logitsFor(sample.vector, weights, bias, classCount, dimension);
    softmaxInto(logits, probs);
    const p = Math.max(probs[sample.classIndex], 1e-12);
    loss += -Math.log(p) * (classWeights[sample.classIndex] ?? 1);
  }
  loss /= Math.max(1, samples.length);

  let l2Term = 0;
  for (let i = 0; i < weights.length; i++) l2Term += weights[i] * weights[i];
  loss += (l2 / 2) * l2Term;

  return loss;
}

export async function trainMultinomialLogistic(
  input: TrainMultinomialLogisticInput,
): Promise<TrainMultinomialLogisticResult> {
  const { samples, classCount, dimension } = input;
  const l2 = input.l2 ?? 0.001;
  const learningRate = input.learningRate ?? 0.5;
  const maxEpochs = input.maxEpochs ?? 200;
  const batchSize = input.batchSize ?? Math.min(32, Math.max(1, samples.length));
  const tolerance = input.tolerance ?? 1e-5;
  const classWeights = input.classWeights ?? new Array(classCount).fill(1);

  const weights = new Float64Array(classCount * dimension); // 초기값 0(결정론 규약)
  const bias = new Float64Array(classCount);

  if (samples.length === 0 || classCount === 0 || dimension === 0) {
    return {
      weights: Float32Array.from(weights),
      bias: Float32Array.from(bias),
      epochs: 0,
      finalLoss: 0,
    };
  }

  const probs = new Float64Array(classCount);
  const gradWeights = new Float64Array(classCount * dimension);
  const gradBias = new Float64Array(classCount);

  let prevLoss = computeLoss(samples, weights, bias, classCount, dimension, l2, classWeights);
  let epoch = 0;

  for (; epoch < maxEpochs; epoch++) {
    // 미니배치는 주어진 순서를 그대로 순차 분할한다(셔플 없음 — 결정론 규약).
    for (let start = 0; start < samples.length; start += batchSize) {
      const end = Math.min(samples.length, start + batchSize);
      const n = end - start;

      gradWeights.fill(0);
      gradBias.fill(0);

      for (let i = start; i < end; i++) {
        const sample = samples[i];
        const logits = logitsFor(sample.vector, weights, bias, classCount, dimension);
        softmaxInto(logits, probs);
        const w = classWeights[sample.classIndex] ?? 1;

        for (let c = 0; c < classCount; c++) {
          const indicator = c === sample.classIndex ? 1 : 0;
          const err = (probs[c] - indicator) * w;
          gradBias[c] += err;
          const offset = c * dimension;
          for (let d = 0; d < dimension; d++) gradWeights[offset + d] += err * sample.vector[d];
        }
      }

      for (let c = 0; c < classCount; c++) {
        bias[c] -= learningRate * (gradBias[c] / n);
        const offset = c * dimension;
        for (let d = 0; d < dimension; d++) {
          const l2Grad = l2 * weights[offset + d];
          weights[offset + d] -= learningRate * (gradWeights[offset + d] / n + l2Grad);
        }
      }

      // 배치 간 양보(설계서 §12.2, AC-L2-17 — 재색인 큐(indexer.service.ts)와 같은 규약) — 학습 중에도
      // 공개 대화 API 등 다른 요청이 이벤트 루프를 점유할 수 있게 한다.
      await new Promise((resolve) => setImmediate(resolve));
    }

    const loss = computeLoss(samples, weights, bias, classCount, dimension, l2, classWeights);
    if (Math.abs(prevLoss - loss) < tolerance) {
      prevLoss = loss;
      epoch += 1;
      break;
    }
    prevLoss = loss;
  }

  return {
    weights: Float32Array.from(weights),
    bias: Float32Array.from(bias),
    epochs: epoch,
    finalLoss: prevLoss,
  };
}

/** 추론 — `softmax(W·q + b)`(설계서 §12.4). 저장된(base64 디코딩된) 가중치를 그대로 받는다. */
export function predictProbabilities(
  vector: Float32Array,
  weights: Float32Array,
  bias: Float32Array,
  classCount: number,
  dimension: number,
): Float64Array {
  const logits = new Float64Array(classCount);
  for (let c = 0; c < classCount; c++) {
    let sum = bias[c];
    const offset = c * dimension;
    for (let d = 0; d < dimension; d++) sum += weights[offset + d] * vector[d];
    logits[c] = sum;
  }
  const out = new Float64Array(classCount);
  softmaxInto(logits, out);
  return out;
}
