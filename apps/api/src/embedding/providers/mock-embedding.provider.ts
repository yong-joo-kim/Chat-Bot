import { createHash } from 'node:crypto';
import { EmbeddingKind, EmbeddingProvider } from '../embedding-provider.port';

/**
 * ml-worker(Python)와 GPU 없이도 apps/api 쪽 로직(캐시·구간 판정 등)을 검증하기 위한
 * 결정론적 해시 기반 임베더. `EMBEDDING_BASE_URL` 미설정 시 이 구현체를 쓴다(설계서 §8.3).
 *
 * 의미 유사도를 반영하지 않으므로 매칭 품질 검증에는 쓰지 않는다 — 그 역할은
 * `apps/ml-worker/eval/sweep_thresholds.py`의 골든셋 실측이 담당한다.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'mock@0|noprefix|l2';

  constructor(readonly dimension: number = 64) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    return texts.map((t) => this.hashVector(t));
  }

  async healthy(): Promise<boolean> {
    return true;
  }

  private hashVector(text: string): Float32Array {
    const key = text.trim().toLowerCase();
    const seed = createHash('sha256').update(key, 'utf8').digest();
    const vec = new Float64Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      const byte = seed[i % seed.length];
      // 결정론적으로 [-1, 1] 범위 값을 만든다. 바이트 위치마다 회전시켜 축별로 다르게 한다.
      const rotated = (byte + i * 31) % 256;
      vec[i] = (rotated / 255) * 2 - 1;
    }
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    const out = new Float32Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) out[i] = vec[i] / norm;
    return out;
  }
}
