import { validateCandidates } from './validate-candidates';

function unit(...dims: number[]): Float32Array {
  const v = new Float32Array(dims.length);
  let norm = 0;
  for (let i = 0; i < dims.length; i++) norm += dims[i] * dims[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims.length; i++) v[i] = dims[i] / norm;
  return v;
}

const THRESHOLDS = { keepMin: 0.75, keepMax: 0.97, noveltyMax: 0.95, acceptThreshold: 0.8 };

describe('validateCandidates', () => {
  it('의미 이탈 후보를 SEMANTIC_DRIFT로 제외한다', () => {
    const seed = unit(1, 0, 0);
    const driftCandidate = unit(0, 1, 0); // 직교 = cos 0
    const result = validateCandidates({
      candidates: ['오늘 날씨가 좋네요'],
      candidateVectors: [driftCandidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.SEMANTIC_DRIFT).toBe(1);
  });

  it('시드와 사실상 동일한 후보를 NEAR_DUPLICATE로 제외한다', () => {
    const seed = unit(1, 0, 0);
    const nearDup = unit(0.999, 0.001, 0);
    const result = validateCandidates({
      candidates: ['환불은 어떻게 하나요'],
      candidateVectors: [nearDup],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.NEAR_DUPLICATE).toBe(1);
  });

  it('기존 예문과 사실상 동일하면 DUPLICATE_OF_EXISTING으로 제외한다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0); // 시드와는 keepMin~keepMax 사이
    const existing = unit(0.86, 0.51, 0); // 후보와 거의 동일
    const result = validateCandidates({
      candidates: ['환불 절차가 궁금해요'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [existing],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.DUPLICATE_OF_EXISTING).toBe(1);
  });

  it('타 의도와 충돌하면 차단하지 않고 경고 필드만 채운다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const otherIntentVec = unit(0.84, 0.54, 0); // acceptThreshold 이상으로 유사
    const result = validateCandidates({
      candidates: ['반품하면 환불되나요'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [{ intentId: 'intent-2', intentName: '반품문의', vector: otherIntentVec }],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].conflictIntentId).toBe('intent-2');
  });

  it('금지어가 포함된 후보를 제외한다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['시발 환불 어떻게 해요'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: ['시발'],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.BANNED_WORD).toBe(1);
  });

  it('영문/기호만으로 구성된 후보는 INVALID_FORMAT으로 제외한다(한국어 판별)', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['Hello World 12345'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.INVALID_FORMAT).toBe(1);
  });

  it('길이 상한을 초과한 후보는 INVALID_FORMAT으로 제외한다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['가'.repeat(201)],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.INVALID_FORMAT).toBe(1);
  });

  it('배치 내 정규화 동일 후보는 1건만 유지하고 집계하지 않는다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['환불 어떻게 해요?', '환불 어떻게 해요?'],
      candidateVectors: [candidate, candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.accepted).toHaveLength(1);
    expect(Object.values(result.rejected).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('전화번호가 포함된 후보는 PII로 판정해 제외한다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['010-1234-5678로 연락 주세요'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.rejected.INVALID_FORMAT).toBe(1);
  });

  it('통과한 후보에는 similarityToSeed가 채워진다', () => {
    const seed = unit(1, 0, 0);
    const candidate = unit(0.85, 0.53, 0);
    const result = validateCandidates({
      candidates: ['환불 어떻게 해요?'],
      candidateVectors: [candidate],
      seedVectors: [seed],
      existingExampleVectors: [],
      otherIntentVectors: [],
      bannedWords: [],
      thresholds: THRESHOLDS,
    });
    expect(result.accepted[0].similarityToSeed).toBeCloseTo(0.85, 2);
  });
});
