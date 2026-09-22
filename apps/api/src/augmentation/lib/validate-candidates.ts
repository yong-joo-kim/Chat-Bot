/**
 * No.16 증강 후보 자기 검증(ADR-0025 §3, 설계서 §10.3). DB·Nest·임베딩 클라이언트 무의존 순수 함수 —
 * 벡터는 전부 인자로 주입받는다(호출부가 `EmbeddingProvider` 배치 1회 + `VectorCacheService`로 조달).
 *
 * 검사 6종(순서 고정, 결정론):
 *   ⑤ 형식(길이·제어문자·한국어 판별·PII 패턴)  → 임베딩 없이 판정 가능한 것부터 먼저 거른다
 *   ④ 금지어
 *   ① 의미 보존 밴드 `keepMin ≤ cos(후보,시드) ≤ keepMax`
 *   ② 신규성 `max cos(후보,기존예문) < noveltyMax`
 *   ⑥ 자기 중복(배치 내 정규화 동일 또는 이미 채택된 후보와 cos ≥ keepMax)
 *   ③ 타 의도 충돌(차단 아님 — 경고 필드만 채운다)
 *
 * 어느 검사든 실패하면 **조용히 제외**한다(FR-0-54) — 예외를 던지지 않는다.
 */
import { normalizeText } from '@chat-bot/shared-types';
import { maskPii } from '@chat-bot/pii-mask';
import { cosineSimilarity } from '../../embedding/lib/cosine';

export type AugmentationRejectReason =
  | 'SEMANTIC_DRIFT'
  | 'NEAR_DUPLICATE'
  | 'DUPLICATE_OF_EXISTING'
  | 'BANNED_WORD'
  | 'INVALID_FORMAT';

export interface AcceptedAugmentationCandidate {
  readonly text: string;
  readonly similarityToSeed: number;
  readonly conflictIntentId?: string;
  readonly conflictScore?: number;
}

export interface OtherIntentVector {
  readonly intentId: string;
  readonly intentName: string;
  readonly vector: Float32Array;
}

export interface AugmentationThresholds {
  readonly keepMin: number;
  readonly keepMax: number;
  readonly noveltyMax: number;
  readonly acceptThreshold: number;
}

export interface ValidateCandidatesInput {
  /** 원시 후보 텍스트(정규화 전). `candidateVectors`와 인덱스가 1:1이다. */
  readonly candidates: readonly string[];
  readonly candidateVectors: readonly Float32Array[];
  readonly seedVectors: readonly Float32Array[];
  readonly existingExampleVectors: readonly Float32Array[];
  readonly otherIntentVectors: readonly OtherIntentVector[];
  readonly bannedWords: readonly string[];
  readonly thresholds: AugmentationThresholds;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export type AugmentationRejectionCounts = Record<AugmentationRejectReason, number>;

export interface ValidateCandidatesResult {
  readonly accepted: AcceptedAugmentationCandidate[];
  readonly rejected: AugmentationRejectionCounts;
}

const HANGUL_RANGE = /[가-힣]/g;
const CONTROL_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function emptyCounts(): AugmentationRejectionCounts {
  return {
    SEMANTIC_DRIFT: 0,
    NEAR_DUPLICATE: 0,
    DUPLICATE_OF_EXISTING: 0,
    BANNED_WORD: 0,
    INVALID_FORMAT: 0,
  };
}

/** 형식 검사(⑤) — 길이·제어문자·정규화 후 공백뿐인지·한국어 판별·PII 패턴. */
function isValidFormat(raw: string, minLength: number, maxLength: number): boolean {
  if (raw.length < minLength || raw.length > maxLength) return false;
  if (CONTROL_CHAR.test(raw)) return false;
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  const hangulCount = (raw.match(HANGUL_RANGE) ?? []).length;
  const letterCount = raw.replace(/[^\p{L}]/gu, '').length;
  if (letterCount === 0 || hangulCount === 0) return false;
  if (hangulCount / letterCount < 0.5) return false; // 대부분이 한글이 아니면 'ko' 후보로 신뢰하지 않는다

  if (maskPii(raw).maskedText !== raw) return false; // PII 패턴이 하나라도 탐지되면 제외(EX-L1-5)

  return true;
}

function containsBannedWord(normalized: string, bannedWords: readonly string[]): boolean {
  return bannedWords.some((w) => {
    if (!w) return false;
    const normalizedWord = normalizeText(w);
    // 정규화 결과가 빈 문자열이면(예: 공백만으로 이뤄진 금지어 항목) 검사에서 제외한다.
    // "".includes()는 항상 true를 반환하므로, 이를 그대로 두면 모든 후보가 금지어로 오탐된다.
    if (!normalizedWord) return false;
    return normalized.includes(normalizedWord);
  });
}

function maxCosine(vector: Float32Array, pool: readonly Float32Array[]): number {
  let max = -1;
  for (const v of pool) {
    const score = cosineSimilarity(vector, v);
    if (score > max) max = score;
  }
  return max;
}

function bestConflict(
  vector: Float32Array,
  otherIntents: readonly OtherIntentVector[],
): { intentId: string; score: number } | undefined {
  let best: { intentId: string; score: number } | undefined;
  for (const o of otherIntents) {
    const score = cosineSimilarity(vector, o.vector);
    if (!best || score > best.score) best = { intentId: o.intentId, score };
  }
  return best;
}

export function validateCandidates(input: ValidateCandidatesInput): ValidateCandidatesResult {
  const { candidates, candidateVectors, thresholds } = input;
  const minLength = input.minLength ?? 1;
  const maxLength = input.maxLength ?? 200;

  const rejected = emptyCounts();
  const accepted: AcceptedAugmentationCandidate[] = [];
  const seenNormalized = new Set<string>();
  const acceptedVectors: Float32Array[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const raw = candidates[i];
    const vector = candidateVectors[i];

    // ⑤ 형식
    if (!isValidFormat(raw, minLength, maxLength)) {
      rejected.INVALID_FORMAT += 1;
      continue;
    }
    const normalized = normalizeText(raw);

    // ⑥-a 배치 내 정규화 동일(자기 중복) — 임베딩 없이도 판정 가능한 부분을 먼저 처리한다.
    if (seenNormalized.has(normalized)) {
      continue; // 카운트하지 않는다(설계서 §10.3 — "1건만 유지"는 집계 대상이 아니다)
    }

    // ④ 금지어
    if (containsBannedWord(normalized, input.bannedWords)) {
      rejected.BANNED_WORD += 1;
      continue;
    }

    if (!vector) {
      // 벡터 조달 실패(배치 임베딩 일부 누락) — 검증 불가이므로 안전하게 제외한다.
      rejected.INVALID_FORMAT += 1;
      continue;
    }

    // ① 의미 보존 밴드
    const similarityToSeed = maxCosine(vector, input.seedVectors);
    if (similarityToSeed < thresholds.keepMin) {
      rejected.SEMANTIC_DRIFT += 1;
      continue;
    }
    if (similarityToSeed > thresholds.keepMax) {
      rejected.NEAR_DUPLICATE += 1;
      continue;
    }

    // ② 신규성
    if (input.existingExampleVectors.length > 0) {
      const noveltyScore = maxCosine(vector, input.existingExampleVectors);
      if (noveltyScore >= thresholds.noveltyMax) {
        rejected.DUPLICATE_OF_EXISTING += 1;
        continue;
      }
    }

    // ⑥-b 이미 채택된 후보와 사실상 동일(배치 내 벡터 기준 자기 중복)
    if (acceptedVectors.length > 0 && maxCosine(vector, acceptedVectors) >= thresholds.keepMax) {
      continue; // 카운트하지 않는다
    }

    // ③ 타 의도 충돌 — 차단하지 않는다. 경고 필드만 채운다.
    const conflict = bestConflict(vector, input.otherIntentVectors);
    const hasConflict = !!conflict && conflict.score >= thresholds.acceptThreshold;

    seenNormalized.add(normalized);
    acceptedVectors.push(vector);
    accepted.push({
      text: raw.trim(),
      similarityToSeed,
      ...(hasConflict ? { conflictIntentId: conflict!.intentId, conflictScore: conflict!.score } : {}),
    });
  }

  return { accepted, rejected };
}
