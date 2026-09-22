import { z } from 'zod';
import {
  EmbeddingKind,
  EmbeddingProvider,
  EmbeddingProviderUnavailableError,
  EmbeddingResponseInvalidError,
} from '../embedding-provider.port';

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'loading']),
  modelId: z.string().nullable().optional(),
  dimension: z.number().int().positive().nullable().optional(),
  device: z.string().optional(),
  warmedUp: z.boolean().optional(),
});

const EmbedResponseSchema = z.object({
  modelId: z.string(),
  dimension: z.number().int().positive(),
  vectors: z.array(z.array(z.number())),
});

/**
 * `apps/ml-worker`(추론 전용 임베딩 서비스)를 호출하는 1차 구현체(ADR-0024).
 *
 * - `modelId`/`dimension`은 `connect()` 시점의 `GET /health` 응답으로 한 번 고정된다
 *   (설계서 §8.3 "기동 시 `GET /health`로 확인하고 메모리에 고정한다").
 * - 타임아웃은 기본 300ms(FR-N1-31). 초과·연결 실패·비정상 상태는 전부
 *   `EmbeddingProviderUnavailableError`로 수렴한다 — 호출부(QueryEmbeddingService 등)가
 *   이 예외 하나만 잡으면 저하 모드로 전환할 수 있다.
 * - 외부 응답은 zod로 파싱하고, 실패하면 `EmbeddingResponseInvalidError`를 던진다
 *   (FR-0-42와 같은 "외부 응답을 신뢰하지 않는다" 원칙).
 */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  private constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly batchMax: number,
    readonly modelId: string,
    readonly dimension: number,
  ) {}

  static async connect(
    baseUrl: string,
    options: { timeoutMs?: number; batchMax?: number } = {},
  ): Promise<HttpEmbeddingProvider> {
    const timeoutMs = options.timeoutMs ?? 300;
    const batchMax = options.batchMax ?? 64;
    const health = await HttpEmbeddingProvider.fetchHealth(baseUrl, timeoutMs);

    if (health.status !== 'ok' || !health.modelId || !health.dimension) {
      throw new EmbeddingProviderUnavailableError(
        `ml-worker가 아직 준비되지 않았습니다(status=${health.status})`,
      );
    }
    return new HttpEmbeddingProvider(baseUrl, timeoutMs, batchMax, health.modelId, health.dimension);
  }

  async embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    if (texts.length > this.batchMax) {
      throw new EmbeddingResponseInvalidError(
        `배치 상한 초과: ${texts.length} > ${this.batchMax}`,
      );
    }

    const body = await this.postJson('/embed', { texts, kind }, EmbedResponseSchema);

    if (body.modelId !== this.modelId || body.dimension !== this.dimension) {
      // 런타임 중 ml-worker의 모델이 바뀐 경우 — 호출부가 EX-N1-2(저하 모드 + staleModel)로 처리하도록
      // 명확한 에러 타입으로 알린다. 여기서 임의로 벡터를 반환하지 않는다.
      throw new EmbeddingProviderUnavailableError(
        `ml-worker 모델이 변경되었습니다(expected=${this.modelId}, actual=${body.modelId})`,
      );
    }

    return body.vectors.map((v) => Float32Array.from(v));
  }

  async healthy(): Promise<boolean> {
    try {
      const health = await HttpEmbeddingProvider.fetchHealth(this.baseUrl, this.timeoutMs);
      return health.status === 'ok' && health.modelId === this.modelId;
    } catch {
      return false;
    }
  }

  private async postJson<T extends z.ZodTypeAny>(
    path: string,
    payload: unknown,
    schema: T,
  ): Promise<z.infer<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new EmbeddingProviderUnavailableError(`ml-worker HTTP ${res.status}`);
      }
      const json = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new EmbeddingResponseInvalidError('ml-worker 응답 스키마 불일치', parsed.error);
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof EmbeddingProviderUnavailableError || err instanceof EmbeddingResponseInvalidError) {
        throw err;
      }
      // AbortError(타임아웃) 포함 — 네트워크 계열 예외는 전부 가용성 에러로 수렴한다.
      throw new EmbeddingProviderUnavailableError('ml-worker 호출 실패', err);
    } finally {
      clearTimeout(timer);
    }
  }

  private static async fetchHealth(
    baseUrl: string,
    timeoutMs: number,
  ): Promise<z.infer<typeof HealthResponseSchema>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) {
        throw new EmbeddingProviderUnavailableError(`ml-worker 헬스체크 HTTP ${res.status}`);
      }
      const json = await res.json();
      const parsed = HealthResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new EmbeddingResponseInvalidError('ml-worker 헬스체크 응답 스키마 불일치', parsed.error);
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof EmbeddingProviderUnavailableError || err instanceof EmbeddingResponseInvalidError) {
        throw err;
      }
      throw new EmbeddingProviderUnavailableError('ml-worker 헬스체크 실패', err);
    } finally {
      clearTimeout(timer);
    }
  }
}
