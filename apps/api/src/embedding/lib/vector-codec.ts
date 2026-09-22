/**
 * `EmbeddingVector.vector` 직렬화 — base64(Float32Array little-endian)(DD-70).
 * JSON 배열이 아니다 — 1024차원 기준 문자열 크기가 2배 이상이고 파싱 비용이 재색인·캐시
 * 워밍에 그대로 붙는다.
 */
export function encodeVector(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

/**
 * base64 → `Float32Array`. 파싱 실패(길이 불일치 포함)는 `null`을 반환한다 — 예외를 던지지 않는다
 * (EX-N1-3, 엔진의 가용성 규약과 대칭). 호출부는 해당 벡터만 제외 + 경고 로그로 처리한다.
 */
export function decodeVector(base64: string, dimension: number): Float32Array | null {
  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.byteLength !== dimension * 4) return null;
    // Buffer 풀의 공유 ArrayBuffer는 4바이트 정렬을 보장하지 않으므로 항상 복사한다.
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return new Float32Array(copy.buffer);
  } catch {
    return null;
  }
}
