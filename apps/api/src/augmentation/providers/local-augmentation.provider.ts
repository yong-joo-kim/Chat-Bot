import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import { EgressBlockedError } from '../../common/egress/egress-guard';
import { AugmentationFailureCause, AugmentationGenerateInput, AugmentationGenerateOutcome, AugmentationProvider } from './augmentation-provider.port';

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

  /** 실패 원인 분류(K-1b §2.3) — 예외를 던지지 않는다. 로그에는 원인 코드만 남긴다(문장·URL·키 0). */
  async generateWithOutcome(input: AugmentationGenerateInput): Promise<AugmentationGenerateOutcome> {
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
      if (!res.ok) return this.fail(res.status >= 400 && res.status < 500 ? 'HTTP_4XX' : 'HTTP_5XX');
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return this.fail(timedOut ? 'TIMEOUT' : 'INVALID_RESPONSE');
      }
      const parsed = AugmentResponseSchema.safeParse(json);
      if (!parsed.success) return this.fail('INVALID_RESPONSE');
      return { candidates: parsed.data.candidates };
    } catch (e) {
      if (e instanceof EgressBlockedError) return this.fail('EGRESS_BLOCKED');
      return this.fail(timedOut ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
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
