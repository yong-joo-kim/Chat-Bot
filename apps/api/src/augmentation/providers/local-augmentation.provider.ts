import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AugmentationGenerateInput, AugmentationProvider } from './augmentation-provider.port';

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

  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}/augment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds: input.seeds, targetCount: input.targetCount, locale: input.locale }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ml-worker /augment HTTP ${res.status}`);
      const json = await res.json();
      const parsed = AugmentResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error('ml-worker /augment 응답 스키마 불일치');
      return parsed.data.candidates;
    } catch (e) {
      this.logger.warn(`ml-worker /augment 호출 실패 — G1로 폴백합니다: ${e instanceof Error ? e.message : 'unknown'}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/augment/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const json = await res.json();
      const parsed = AugmentHealthResponseSchema.safeParse(json);
      return parsed.success && parsed.data.status === 'ok';
    } catch {
      return false;
    }
  }
}
