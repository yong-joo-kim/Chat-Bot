import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagHttpClient } from './rag-http.client';
import { RagStatusResponseSchema } from './lib/rag-response.schema';

/**
 * 유량 제어(§9.7) — 동시성·자체 레이트리밋·회로차단기·`GET /api/status` 캐시(60초).
 * 상태 확인만으로 방어하지 않는다(FR-N2-31) — vLLM 사망 감지에 최대 15초 지연이 있어
 * 회로차단기와 병행한다.
 */
@Injectable()
export class RagGateService {
  private readonly logger = new Logger('RagGateService');
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private inFlight = 0;
  private rateWindowStartedAt = Date.now();
  private rateCount = 0;
  private statusCache: { vllmReady: boolean; checkedAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ragHttpClient: RagHttpClient,
  ) {}

  isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  /** 동시성·레이트리밋·회로 여유가 있으면 슬롯을 점유하고 true를 반환한다(대기하지 않는다, FR-N2-29). */
  tryAcquire(): boolean {
    if (this.isCircuitOpen()) return false;

    const now = Date.now();
    if (now - this.rateWindowStartedAt >= 60_000) {
      this.rateWindowStartedAt = now;
      this.rateCount = 0;
    }
    const rateLimit = this.config.get<number>('RAG_RATE_LIMIT_PER_MIN') ?? 60;
    if (this.rateCount >= rateLimit) return false;

    const maxConcurrency = this.config.get<number>('RAG_MAX_CONCURRENCY') ?? 5;
    if (this.inFlight >= maxConcurrency) return false;

    this.rateCount += 1;
    this.inFlight += 1;
    return true;
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    const threshold = this.config.get<number>('RAG_CIRCUIT_FAILURE_THRESHOLD') ?? 5;
    if (this.consecutiveFailures >= threshold) {
      const openMs = this.config.get<number>('RAG_CIRCUIT_OPEN_MS') ?? 60_000;
      this.circuitOpenUntil = Date.now() + openMs;
      this.logger.warn(`RAG 연속 실패 ${this.consecutiveFailures}회 — ${openMs}ms 동안 2단계를 건너뜁니다(회로 open).`);
    }
  }

  /** `null` = 상태를 확인할 수 없음(응답 판정에는 영향 없음 — 회로차단기가 최종 방어선). */
  async isVllmReady(): Promise<boolean | null> {
    const cacheMs = this.config.get<number>('RAG_STATUS_CACHE_MS') ?? 60_000;
    if (this.statusCache && Date.now() - this.statusCache.checkedAt < cacheMs) return this.statusCache.vllmReady;

    const result = await this.ragHttpClient.status(5000);
    if (result.networkError || result.httpStatus >= 500) {
      this.statusCache = { vllmReady: false, checkedAt: Date.now() };
      return false;
    }
    const parsed = RagStatusResponseSchema.safeParse(result.body);
    const vllmReady = parsed.success ? parsed.data.vllm_ready : false;
    this.statusCache = { vllmReady, checkedAt: Date.now() };
    return vllmReady;
  }
}
