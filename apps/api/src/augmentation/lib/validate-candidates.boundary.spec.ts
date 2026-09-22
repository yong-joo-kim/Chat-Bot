import { cosineSimilarity } from '../../embedding/lib/cosine';
import { validateCandidates } from './validate-candidates';

/**
 * `validateCandidates()` 경계값(boundary-value) 전용 테스트 — 5종 검증(의미보존/신규성/타의도충돌/
 * 금지어/형식)의 임계값 안팎(inclusive/exclusive)을 명시적으로 고정한다.
 * `validate-candidates.spec.ts`(기존, 재작성 금지)의 "명백한 값" 테스트를 보완한다 —
 * 이 파일은 임계값에 **바짝 붙은 값**만 다룬다.
 *
 * ①②③(코사인 기반) 검사는 `cosineSimilarity`의 기본 동작은 실제 구현(`requireActual`)을 쓰되,
 * 필요한 테스트에서만 `mockReturnValueOnce`로 반환값을 직접 주입한다 — 0.97·0.95·0.8은 2진
 * 부동소수점으로 정확히 표현되지 않아(`Float32Array` 저장 시 반올림 발생) 실제 벡터로 "정확히 그
 * 값"을 재현하면 오차가 threshold 판정에 섞인다. 반환값을 직접 주입하면 threshold 비교 로직
 * (`<`, `>`, `>=`)만 순수하게 검증할 수 있다. ④⑤(문자열 기반) 검사는 이 대체와 무관하므로
 * 실제 구현이 그대로 쓰인다(큐가 비어 있으면 기본 구현으로 폴백).
 */

jest.mock('../../embedding/lib/cosine', () => {
  const actual = jest.requireActual('../../embedding/lib/cosine');
  return { cosineSimilarity: jest.fn(actual.cosineSimilarity) };
});

const mockCosine = cosineSimilarity as jest.Mock;
const THRESHOLDS = { keepMin: 0.75, keepMax: 0.97, noveltyMax: 0.95, acceptThreshold: 0.8 };
const DUMMY = new Float32Array([0]);

afterEach(() => {
  mockCosine.mockClear();
});

function runSingle(similarityToSeed: number, opts: { novelty?: number; conflict?: number } = {}) {
  const calls: number[] = [similarityToSeed];
  if (opts.novelty !== undefined) calls.push(opts.novelty);
  if (opts.conflict !== undefined) calls.push(opts.conflict);
  for (const v of calls) mockCosine.mockReturnValueOnce(v);

  return validateCandidates({
    candidates: ['후보 문장입니다'],
    candidateVectors: [DUMMY],
    seedVectors: [DUMMY],
    existingExampleVectors: opts.novelty !== undefined ? [DUMMY] : [],
    otherIntentVectors: opts.conflict !== undefined ? [{ intentId: 'other-1', intentName: '다른의도', vector: DUMMY }] : [],
    bannedWords: [],
    thresholds: THRESHOLDS,
  });
}

describe('validateCandidates — 경계값(코사인 기반 ①②③, cosineSimilarity 반환값 직접 주입)', () => {
  describe('① 의미 보존 밴드 [keepMin, keepMax] — 양끝 포함(inclusive)', () => {
    it('keepMin(0.75) 경계값 자체는 SEMANTIC_DRIFT로 제외되지 않는다(하한 포함, `<` 비교이므로 등호는 통과)', () => {
      const result = runSingle(0.75);
      expect(result.rejected.SEMANTIC_DRIFT).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });

    it('keepMin보다 아주 조금 낮으면(0.749999) SEMANTIC_DRIFT로 제외된다', () => {
      const result = runSingle(0.749999);
      expect(result.rejected.SEMANTIC_DRIFT).toBe(1);
      expect(result.accepted).toHaveLength(0);
    });

    it('keepMax(0.97) 경계값 자체는 NEAR_DUPLICATE로 제외되지 않는다(상한 포함, `>` 비교이므로 등호는 통과)', () => {
      const result = runSingle(0.97);
      expect(result.rejected.NEAR_DUPLICATE).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });

    it('keepMax보다 아주 조금 높으면(0.970001) NEAR_DUPLICATE로 제외된다', () => {
      const result = runSingle(0.970001);
      expect(result.rejected.NEAR_DUPLICATE).toBe(1);
      expect(result.accepted).toHaveLength(0);
    });
  });

  describe('② 신규성 — max cos(후보, 기존예문) >= noveltyMax 이면 제외(하한 포함)', () => {
    it('신규성 점수가 noveltyMax(0.95)와 정확히 같으면 DUPLICATE_OF_EXISTING이다(`>=` 비교이므로 등호도 제외)', () => {
      const result = runSingle(0.9, { novelty: 0.95 });
      expect(result.rejected.DUPLICATE_OF_EXISTING).toBe(1);
      expect(result.accepted).toHaveLength(0);
    });

    it('신규성 점수가 noveltyMax보다 아주 조금 낮으면(0.949999) 통과한다', () => {
      const result = runSingle(0.9, { novelty: 0.949999 });
      expect(result.rejected.DUPLICATE_OF_EXISTING).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });
  });

  describe('③ 타 의도 충돌 — score >= acceptThreshold, 하한 포함(inclusive), 차단이 아니라 경고', () => {
    it('충돌 점수가 acceptThreshold(0.8)와 정확히 같으면 충돌 경고 필드가 채워진다(등호 포함, 차단은 아님)', () => {
      const result = runSingle(0.85, { conflict: 0.8 });
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].conflictIntentId).toBe('other-1');
      expect(result.accepted[0].conflictScore).toBe(0.8);
    });

    it('충돌 점수가 acceptThreshold보다 아주 조금 낮으면(0.799999) 충돌 필드가 비어 있다', () => {
      const result = runSingle(0.85, { conflict: 0.799999 });
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].conflictIntentId).toBeUndefined();
    });
  });
});

describe('validateCandidates — 경계값(문자열 기반 ④⑤, 실제 cosineSimilarity 사용)', () => {
  const SEED = new Float32Array([1]);

  function vec(x: number): Float32Array {
    return new Float32Array([x]);
  }

  describe('④ 금지어 — 정규화 후 정확 포함(includes) 판정 경계', () => {
    it('금지어가 문장 전체와 정확히 일치하면(부분이 아니라 전체) 제외된다', () => {
      const result = validateCandidates({
        candidates: ['금칙어'],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: ['금칙어'],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.BANNED_WORD).toBe(1);
    });

    it('빈 문자열("") 금지어 항목은 falsy 가드로 무시되고 통과에 영향을 주지 않는다', () => {
      const result = validateCandidates({
        candidates: ['정상적인 문장입니다'],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: ['', '실제금지어'],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.BANNED_WORD).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });

    it('공백만으로 된("   ") 금지어 항목은 정규화 후 빈 문자열이 되어 무시되고, 정상 후보가 오탐 차단되지 않는다(회귀 방지 — 과거 Medium 등급 결함)', () => {
      const result = validateCandidates({
        candidates: ['정상적인 문장입니다'],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: ['   '],
        thresholds: THRESHOLDS,
      });
      // 정규화 결과가 빈 문자열인 금지어 항목은 includes() 판정에 사용하지 않는다 — "".includes("")가 항상 true인 함정을 피한다.
      expect(result.rejected.BANNED_WORD).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });
  });

  describe('⑤ 형식 — 길이 [minLength, maxLength] 양끝 포함, 커스텀 경계도 동일 규약', () => {
    it('기본 상한(200자) 정확히 맞으면(경계값) 통과한다', () => {
      const text = '가'.repeat(200);
      const result = validateCandidates({
        candidates: [text],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: [],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.INVALID_FORMAT).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });

    it('기본 상한보다 1자 많으면(201자) INVALID_FORMAT이다', () => {
      const text = '가'.repeat(201);
      const result = validateCandidates({
        candidates: [text],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: [],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.INVALID_FORMAT).toBe(1);
    });

    it('기본 하한(1자) 정확히 맞으면(경계값) 통과한다', () => {
      const result = validateCandidates({
        candidates: ['가'],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: [],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.INVALID_FORMAT).toBe(0);
      expect(result.accepted).toHaveLength(1);
    });

    it('빈 문자열(0자)은 INVALID_FORMAT이다(하한 미만)', () => {
      const result = validateCandidates({
        candidates: [''],
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: [],
        thresholds: THRESHOLDS,
      });
      expect(result.rejected.INVALID_FORMAT).toBe(1);
    });

    it('커스텀 minLength/maxLength(둘 다 5)를 지정하면 정확히 5자만 통과하고 4자·6자는 제외된다', () => {
      const base = {
        candidateVectors: [vec(0.85)],
        seedVectors: [SEED],
        existingExampleVectors: [],
        otherIntentVectors: [],
        bannedWords: [],
        thresholds: THRESHOLDS,
        minLength: 5,
        maxLength: 5,
      };
      const exact = validateCandidates({ ...base, candidates: ['가나다라마'] });
      const short = validateCandidates({ ...base, candidates: ['가나다라'] });
      const long = validateCandidates({ ...base, candidates: ['가나다라마바'] });

      expect(exact.rejected.INVALID_FORMAT).toBe(0);
      expect(exact.accepted).toHaveLength(1);
      expect(short.rejected.INVALID_FORMAT).toBe(1);
      expect(long.rejected.INVALID_FORMAT).toBe(1);
    });
  });
});
