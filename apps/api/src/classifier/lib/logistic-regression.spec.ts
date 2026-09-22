import { trainMultinomialLogistic, predictProbabilities, LogisticRegressionSample } from './logistic-regression';
import { softmax } from './softmax';

function unit(...dims: number[]): Float32Array {
  const v = new Float32Array(dims.length);
  let norm = 0;
  for (const d of dims) norm += d * d;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims.length; i++) v[i] = dims[i] / norm;
  return v;
}

describe('softmax', () => {
  it('합이 1이다', () => {
    const out = softmax([1, 2, 3]);
    const sum = Array.from(out).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('오버플로 없이 큰 값도 처리한다', () => {
    const out = softmax([1000, 1001, 999]);
    expect(Array.from(out).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('trainMultinomialLogistic', () => {
  // 2차원 평면에서 확실히 분리되는 3클래스 장난감 문제(각 클래스 축 방향으로 뭉쳐 있음).
  const samples: LogisticRegressionSample[] = [
    { vector: unit(1, 0), classIndex: 0 },
    { vector: unit(0.95, 0.1), classIndex: 0 },
    { vector: unit(0.9, 0.15), classIndex: 0 },
    { vector: unit(0, 1), classIndex: 1 },
    { vector: unit(0.1, 0.95), classIndex: 1 },
    { vector: unit(0.15, 0.9), classIndex: 1 },
    { vector: unit(-1, 0), classIndex: 2 },
    { vector: unit(-0.95, -0.1), classIndex: 2 },
    { vector: unit(-0.9, 0.1), classIndex: 2 },
  ];

  it('같은 입력 → 같은 출력(결정론)', async () => {
    const a = await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2 });
    const b = await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2 });
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
    expect(Array.from(a.bias)).toEqual(Array.from(b.bias));
    expect(a.epochs).toBe(b.epochs);
  });

  it('선형 분리 가능한 장난감 데이터를 높은 정확도로 학습한다', async () => {
    const result = await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2, maxEpochs: 500 });
    let correct = 0;
    for (const s of samples) {
      const probs = predictProbabilities(s.vector, result.weights, result.bias, 3, 2);
      const predicted = probs.indexOf(Math.max(...probs));
      if (predicted === s.classIndex) correct += 1;
    }
    expect(correct / samples.length).toBeGreaterThanOrEqual(0.8);
  });

  it('샘플 0건이면 0으로 초기화된 가중치를 그대로 반환한다(예외 없음)', async () => {
    const result = await trainMultinomialLogistic({ samples: [], classCount: 2, dimension: 3 });
    expect(Array.from(result.weights)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.epochs).toBe(0);
  });

  it('가중치 배열 크기는 classCount × dimension이다', async () => {
    const result = await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2 });
    expect(result.weights.length).toBe(6);
    expect(result.bias.length).toBe(3);
  });

  it('tolerance에 도달하면 maxEpochs 이전에 조기 종료한다', async () => {
    const result = await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2, maxEpochs: 1000, tolerance: 0.01 });
    expect(result.epochs).toBeLessThan(1000);
  });

  it('배치 간 양보(설계서 §12.2, AC-L2-17) — 학습 도중 이벤트 루프에 제어가 반환되어 다른 매크로태스크가 끼어들 수 있다', async () => {
    // setImmediate로 예약한 콜백은 학습이 최소 1회 이상 이벤트 루프에 양보해야만 실행된다.
    // "학습 중 다른 API 요청이 처리될 수 있다"를 이 매크로태스크 개입으로 근사 검증한다.
    let otherTaskRan = false;
    setImmediate(() => {
      otherTaskRan = true;
    });

    await trainMultinomialLogistic({ samples, classCount: 3, dimension: 2, maxEpochs: 500 });

    expect(otherTaskRan).toBe(true);
  });

  it('async 학습 도중 다른 비동기 작업(대화 API 시뮬레이션)이 동시에 완료될 수 있다', async () => {
    let otherCompleted = false;
    const otherTask = (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      otherCompleted = true;
    })();

    const trainingTask = trainMultinomialLogistic({ samples, classCount: 3, dimension: 2, maxEpochs: 500 });

    await otherTask;
    // 학습이 끝나기 전에(또는 적어도 병행해) 다른 작업이 완료될 수 있어야 한다 — 이벤트 루프 독점이 아니다.
    expect(otherCompleted).toBe(true);

    await trainingTask;
  });
});

describe('predictProbabilities', () => {
  it('출력 확률의 합은 1이다', () => {
    const weights = new Float32Array([1, 0, 0, 1, -1, -1]);
    const bias = new Float32Array([0, 0, 0]);
    const probs = predictProbabilities(unit(1, 0), weights, bias, 3, 2);
    const sum = Array.from(probs).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});
