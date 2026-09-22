/**
 * 코사인 유사도 = 내적(FR-N1-5). 저장·질의 벡터가 전부 L2 정규화되어 있다는 전제이며,
 * 여기서 다시 정규화하지 않는다(§8.3 — 정규화 책임은 `EmbeddingProvider` 구현체에 있다).
 * 차원이 다르면 0을 반환한다(모델 교체 직후 등 — 호출부가 `staleModel`로 처리한다, EX-N1-2).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
