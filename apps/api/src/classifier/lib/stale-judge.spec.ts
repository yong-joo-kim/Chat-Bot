import { judgeClassifierStale } from './stale-judge';

describe('judgeClassifierStale() — ADR-0027 §6 stale 3조건', () => {
  const base = {
    trainedModelId: 'model-a',
    currentModelId: 'model-a',
    intentCountAtTrain: 10,
    currentIntentCount: 10,
    exampleCountAtTrain: 100,
    currentExampleCount: 100,
  };

  it('모두 동일하면 stale이 아니다', () => {
    const result = judgeClassifierStale(base);
    expect(result).toEqual({ stale: false, reasons: [], disabled: false });
  });

  it('AC-L2-11 — modelId가 바뀌면 MODEL_CHANGED이며 즉시 사용 중지(disabled) 대상이다', () => {
    const result = judgeClassifierStale({ ...base, currentModelId: 'model-b' });
    expect(result.reasons).toContain('MODEL_CHANGED');
    expect(result.disabled).toBe(true);
    expect(result.stale).toBe(true);
  });

  it('currentModelId가 없으면(임베딩 서비스 중지) MODEL_CHANGED로 판정한다', () => {
    const result = judgeClassifierStale({ ...base, currentModelId: undefined });
    expect(result.reasons).toContain('MODEL_CHANGED');
    expect(result.disabled).toBe(true);
  });

  it('의도 수가 10% 이상 변하면 INTENTS_DRIFTED이지만 disabled는 아니다(경고만)', () => {
    const result = judgeClassifierStale({ ...base, currentIntentCount: 12 });
    expect(result.reasons).toEqual(['INTENTS_DRIFTED']);
    expect(result.disabled).toBe(false);
    expect(result.stale).toBe(true);
  });

  it('의도 수 변화가 10% 미만이면 INTENTS_DRIFTED가 아니다', () => {
    const result = judgeClassifierStale({ ...base, currentIntentCount: 10, intentCountAtTrain: 10 });
    expect(result.reasons).not.toContain('INTENTS_DRIFTED');
  });

  it('AC-L2-12 — 예문이 50건 초과 추가되면 EXAMPLES_DRIFTED이지만 계속 사용 가능하다', () => {
    const result = judgeClassifierStale({ ...base, currentExampleCount: base.exampleCountAtTrain + 60 });
    expect(result.reasons).toEqual(['EXAMPLES_DRIFTED']);
    expect(result.disabled).toBe(false);
  });

  it('예문 증가가 50건 이하이면 EXAMPLES_DRIFTED가 아니다', () => {
    const result = judgeClassifierStale({ ...base, currentExampleCount: base.exampleCountAtTrain + 50 });
    expect(result.reasons).not.toContain('EXAMPLES_DRIFTED');
  });

  it('세 조건이 동시에 발생하면 모두 보고된다', () => {
    const result = judgeClassifierStale({
      trainedModelId: 'model-a',
      currentModelId: 'model-b',
      intentCountAtTrain: 10,
      currentIntentCount: 20,
      exampleCountAtTrain: 100,
      currentExampleCount: 200,
    });
    expect(result.reasons).toEqual(['MODEL_CHANGED', 'INTENTS_DRIFTED', 'EXAMPLES_DRIFTED']);
    expect(result.disabled).toBe(true);
  });
});
