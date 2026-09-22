/**
 * `IntentClassifierModel.weights`/`bias` 직렬화(DD-111) — `EmbeddingVector.vector`와 **같은 코덱 1벌**을
 * 재사용한다. 신규 로직은 없다 — `embedding/lib/vector-codec.ts`를 그대로 재노출해 `classifier` 계층에서
 * 임포트 경로만 짧게 유지한다.
 */
export { encodeVector as encodeClassifierVector, decodeVector as decodeClassifierVector } from '../../embedding/lib/vector-codec';
