import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import { EgressBlockedError } from '../../common/egress/egress-guard';
import { AugmentationFailureCause, AugmentationGenerateInput, AugmentationGenerateOutcome, AugmentationProvider } from './augmentation-provider.port';
import { AugmentationCircuit, CircuitOutcome, classifyCircuitFailure } from './lib/augmentation-circuit';

const AugmentResponseSchema = z.object({
  modelId: z.string(),
  candidates: z.array(z.string()),
});

const AugmentHealthResponseSchema = z.object({
  status: z.enum(['ok', 'loading']),
  modelId: z.string().nullable().optional(),
  device: z.string().optional(),
  warmedUp: z.boolean().optional(),
});

export interface LocalAugmentationConfig {
  readonly baseUrl: string; // `AUGMENTATION_LOCAL_BASE_URL`. 팩토리가 미설정 시 이 provider를 만들지 않는다.
  readonly timeoutMs?: number;
  /** [K-1c] 팩토리가 소유한 공급자별 공유 회로. 없으면 회로 없음(현행 그대로). */
  readonly circuit?: AugmentationCircuit;
}

/**
 * G3 — ml-worker의 선택적 생성 프로파일(`ML_WORKER_ROLE=augment|both`)을 호출한다(ADR-0026 §5).
 * `apps/api`는 이 provider 1개로만 G3를 안다 — 모델·서빙 엔진·프롬프트 규칙을 알지 못한다
 * (`/embed`의 `kind` 프리픽스 규칙을 `apps/api`가 모르는 것과 같은 경계, DD-101).
 */
export class LocalAugmentationProvider implements AugmentationProvider {
  readonly providerId = 'local' as const;
  readonly requiresNetwork = true;

  private readonly logger = new Logger('LocalAugmentationProvider');

  constructor(private readonly config: LocalAugmentationConfig) {}

  /** `generateWithOutcome()`의 후보만 돌려주는 얇은 위임 — 계약(C-1)·서명 불변. */
  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    return (await this.generateWithOutcome(input)).candidates;
  }

  /**
   * 실패 원인 분류(K-1b §2.3) — 예외를 던지지 않는다. 로그에는 원인 코드만 남긴다(문장·URL·키 0).
   * 공유 회로가 주입됐으면(K-1c) 호출 전 확인 → 개방 중이면 네트워크 호출 없이 `CIRCUIT_OPEN`, 인프라 실패만 계수한다.
   */
  async generateWithOutcome(input: AugmentationGenerateInput): Promise<AugmentationGenerateOutcome> {
    const permit = this.config.circuit ? this.config.circuit.tryAcquire() : undefined;
    if (permit === null) return this.fail('CIRCUIT_OPEN');

    let circuitOutcome: CircuitOutcome = 'neutral';
    const failed = (cause: AugmentationFailureCause, httpStatus?: number): AugmentationGenerateOutcome => {
      circuitOutcome = classifyCircuitFailure(cause, httpStatus);
      return this.fail(cause);
    };

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const url = `${this.config.baseUrl}/augment`;
      assertEgressAllowed('AUGMENT_LOCAL', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds: input.seeds, targetCount: input.targetCount, locale: input.locale }),
        signal: controller.signal,
        redirect: egressRedirectMode(),
      });
      assertNoRedirectResponse('AUGMENT_LOCAL', url, res.status);
      if (!res.ok) return failed(res.status >= 400 && res.status < 500 ? 'HTTP_4XX' : 'HTTP_5XX', res.status);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return failed(timedOut ? 'TIMEOUT' : 'INVALID_RESPONSE');
      }
      const parsed = AugmentResponseSchema.safeParse(json);
      if (!parsed.success) return failed('INVALID_RESPONSE');
      circuitOutcome = 'success';
      return { candidates: parsed.data.candidates };
    } catch (e) {
      if (e instanceof EgressBlockedError) return failed('EGRESS_BLOCKED');
      return failed(timedOut ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
      if (permit) this.config.circuit?.record(permit, circuitOutcome); // 탐침 누수 방지 — 어떤 경로든 반드시 기록한다.
    }
  }

  private fail(failure: AugmentationFailureCause): AugmentationGenerateOutcome {
    this.logger.warn(`ml-worker /augment 호출 실패 — G1 폴백 대상: cause=${failure}`);
    return { candidates: [], failure };
  }

  async healthy(): Promise<boolean> {
    try {
      const url = `${this.config.baseUrl}/augment/health`;
      assertEgressAllowed('AUGMENT_LOCAL', url);
      const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: egressRedirectMode() });
      assertNoRedirectResponse('AUGMENT_LOCAL', url, res.status);
      if (!res.ok) return false;
      const json = await res.json();
      const parsed = AugmentHealthResponseSchema.safeParse(json);
      return parsed.success && parsed.data.status === 'ok';
    } catch {
      return false;
    }
  }
}
