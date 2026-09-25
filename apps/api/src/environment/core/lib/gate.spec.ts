import { evaluateProdSwitchGate, computePassRate } from './gate';
import type { GateLatestRun } from './gate';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function run(overrides: Partial<GateLatestRun> = {}): GateLatestRun {
  return {
    runId: 'run-1',
    setId: 'set-1',
    setName: '세트',
    summaryA: { pass: 9, fail: 1, notJudged: 0, unresolved: 0 },
    finishedAt: new Date('2026-02-28T00:00:00.000Z'),
    embeddingModelId: 'model-a',
    ...overrides,
  };
}

describe('computePassRate', () => {
  it('분모 0이면 0이다', () => {
    expect(computePassRate({ pass: 0, fail: 0, notJudged: 0, unresolved: 0 })).toBe(0);
  });
  it('pass/(pass+fail+notJudged+unresolved)이다', () => {
    expect(computePassRate({ pass: 9, fail: 1, notJudged: 0, unresolved: 0 })).toBeCloseTo(0.9);
  });
});

describe('evaluateProdSwitchGate — §10 표', () => {
  const baseSettings = { mode: 'WARN' as const, testSetId: 'set-1', minPassRate: 80, validHours: 24 };

  it('testSetId 없음 · WARN · 실행 없음 → WARN/NO_RUN', () => {
    const result = evaluateProdSwitchGate({
      settings: { ...baseSettings, testSetId: null },
      latestRun: null,
      setExists: true,
      currentEmbeddingModelId: 'model-a',
      now: NOW,
      kind: 'SWITCH',
    });
    expect(result).toEqual({ verdict: 'WARN', reason: 'NO_RUN', run: null });
  });

  it('testSetId 있음 · 세트 없음 · BLOCK → BLOCK/SET_MISSING(설정 오류)', () => {
    const result = evaluateProdSwitchGate({
      settings: { ...baseSettings, mode: 'BLOCK' },
      latestRun: null,
      setExists: false,
      currentEmbeddingModelId: 'model-a',
      now: NOW,
      kind: 'SWITCH',
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.reason).toBe('SET_MISSING');
  });

  it('실행 없음 → WARN/BLOCK 모드에 따라 NO_RUN', () => {
    const result = evaluateProdSwitchGate({ settings: baseSettings, latestRun: null, setExists: true, currentEmbeddingModelId: 'model-a', now: NOW, kind: 'SWITCH' });
    expect(result).toEqual({ verdict: 'WARN', reason: 'NO_RUN', run: null });
  });

  it('만료(validHours 경과) → EXPIRED', () => {
    const oldRun = run({ finishedAt: new Date('2026-01-01T00:00:00.000Z') });
    const result = evaluateProdSwitchGate({ settings: baseSettings, latestRun: oldRun, setExists: true, currentEmbeddingModelId: 'model-a', now: NOW, kind: 'SWITCH' });
    expect(result.reason).toBe('EXPIRED');
  });

  it('임베딩 모델이 바뀌면 MODEL_CHANGED', () => {
    const result = evaluateProdSwitchGate({ settings: baseSettings, latestRun: run(), setExists: true, currentEmbeddingModelId: 'model-b', now: NOW, kind: 'SWITCH' });
    expect(result.reason).toBe('MODEL_CHANGED');
  });

  it('합격률 미달 → BELOW_THRESHOLD', () => {
    const failing = run({ summaryA: { pass: 5, fail: 5, notJudged: 0, unresolved: 0 } });
    const result = evaluateProdSwitchGate({ settings: baseSettings, latestRun: failing, setExists: true, currentEmbeddingModelId: 'model-a', now: NOW, kind: 'SWITCH' });
    expect(result.reason).toBe('BELOW_THRESHOLD');
  });

  it('전부 통과 → PASS/PASSED', () => {
    const result = evaluateProdSwitchGate({ settings: baseSettings, latestRun: run(), setExists: true, currentEmbeddingModelId: 'model-a', now: NOW, kind: 'SWITCH' });
    expect(result.verdict).toBe('PASS');
    expect(result.reason).toBe('PASSED');
    expect(result.run?.passRate).toBeCloseTo(0.9);
  });

  it('★ kind=ROLLBACK이면 BLOCK을 WARN으로 낮춘다(긴급 복귀 우선)', () => {
    const failing = run({ summaryA: { pass: 0, fail: 10, notJudged: 0, unresolved: 0 } });
    const blockResult = evaluateProdSwitchGate({
      settings: { ...baseSettings, mode: 'BLOCK' },
      latestRun: failing,
      setExists: true,
      currentEmbeddingModelId: 'model-a',
      now: NOW,
      kind: 'SWITCH',
    });
    expect(blockResult.verdict).toBe('BLOCK');

    const rollbackResult = evaluateProdSwitchGate({
      settings: { ...baseSettings, mode: 'BLOCK' },
      latestRun: failing,
      setExists: true,
      currentEmbeddingModelId: 'model-a',
      now: NOW,
      kind: 'ROLLBACK',
    });
    expect(rollbackResult.verdict).toBe('WARN');
  });
});
