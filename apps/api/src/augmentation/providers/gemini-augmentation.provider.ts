import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { maskPii } from '@chat-bot/pii-mask';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import { AUGMENT_GEMINI_DEFAULT_BASE_URL } from '../../common/egress/egress-registry';
import { AUGMENTATION_SYSTEM_INSTRUCTION, buildAugmentationUserContent } from '../lib/gemini-prompt';
import { AugmentationGenerateInput, AugmentationProvider } from './augmentation-provider.port';

/** 기동 검사(§6.4)와 같은 상수를 쓴다(`common/egress/egress-registry.ts`) — export(§6.1 표). */
const DEFAULT_BASE_URL = AUGMENT_GEMINI_DEFAULT_BASE_URL;
const DEFAULT_MODEL = 'gemini-2.0-flash';

export interface GeminiAugmentationConfig {
  readonly apiKey: string; // 팩토리가 빈 값이면 이 provider를 아예 만들지 않는다(DD-97).
  readonly model?: string;
  readonly baseUrl?: string; // 사내 프록시·게이트웨이 주입용(하드코딩 금지 원칙).
  readonly timeoutMs?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitOpenMs?: number;
  /** 시드 송신 전 검사할 금지어. DB 접근은 호출부(팩토리 생성 시점) 책임 — provider는 배열만 받는다. */
  readonly bannedWords?: readonly string[];
}

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/**
 * G2 — Google Gemini(PM 확정, ADR-0026 §4). **공식 SDK를 쓰지 않고 `fetch` + zod로 REST를 직접
 * 호출**한다 — 마스킹·타임아웃·회로차단이 모든 외부 출구에서 동일하게 적용되어야 하기 때문이다.
 * `apiKey`가 없으면 이 클래스는 인스턴스화되지 않는다(팩토리가 담당) — 여기서는 방어적으로 한 번 더
 * 확인해 빈 배열을 반환한다(C-1).
 */
export class GeminiAugmentationProvider implements AugmentationProvider {
  readonly providerId = 'gemini' as const;
  readonly requiresNetwork = true;

  private readonly logger = new Logger('GeminiAugmentationProvider');
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly config: GeminiAugmentationConfig) {}

  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    if (!this.config.apiKey) return []; // 방어적 이중 확인(C-1)
    if (this.isCircuitOpen()) return [];

    try {
      const maskedSeeds = input.seeds.map((s) => maskPii(s).maskedText);
      const banned = this.config.bannedWords ?? [];
      if (maskedSeeds.some((s) => banned.some((w) => w && s.includes(w)))) {
        // 시드 자체에 금지어가 있으면 외부로 내보내지 않는다(FR-L1-6 강제 경로 ②).
        return [];
      }

      const candidates = await this.callGemini(maskedSeeds, input.targetCount);
      this.recordSuccess();
      return candidates;
    } catch (e) {
      this.recordFailure();
      this.logger.warn(`Gemini 호출 실패 — G1로 폴백합니다: ${e instanceof Error ? e.message : 'unknown'}`);
      return [];
    }
  }

  async healthy(): Promise<boolean> {
    return !!this.config.apiKey && !this.isCircuitOpen();
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    const threshold = this.config.circuitFailureThreshold ?? 5;
    if (this.consecutiveFailures >= threshold) {
      const openMs = this.config.circuitOpenMs ?? 60_000;
      this.circuitOpenUntil = Date.now() + openMs;
      this.logger.warn(`Gemini 연속 실패 ${this.consecutiveFailures}회 — ${openMs}ms 동안 회로를 엽니다.`);
    }
  }

  private async callGemini(seeds: readonly string[], targetCount: number): Promise<string[]> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const model = this.config.model ?? DEFAULT_MODEL;
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: AUGMENTATION_SYSTEM_INSTRUCTION },
            { text: buildAugmentationUserContent(seeds, targetCount) },
          ],
        },
      ],
      generationConfig: { temperature: 0.9, candidateCount: 1 },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      assertEgressAllowed('AUGMENT_GEMINI', baseUrl);
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: egressRedirectMode(),
      });
      // [신규 No.45] M-1 — 가드는 baseUrl로 판정하므로(URL에 `?key=`가 있어 URL 전체로 판정하지 않는다),
      // 응답이 비허용 호스트로의 리다이렉트(3xx)면 여기서 별도로 막는다. `generate()`의 catch가
      // recordFailure() + [] (G1 폴백)로 흡수한다.
      assertNoRedirectResponse('AUGMENT_GEMINI', baseUrl, res.status);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);

    const json = await res.json();
    const parsed = GeminiResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error('Gemini 응답 스키마 불일치');

    const text = parsed.data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return parseCandidateArray(text);
  }
}

/**
 * 모델 응답에서 문자열 배열을 뽑아낸다. 코드블록(```)이 섞여 와도 JSON 부분만 추출을 시도하고,
 * 그래도 실패하면 줄 단위 폴백을 쓴다. 어떤 경우든 예외를 던지지 않고 빈 배열로 수렴한다(C-1).
 */
export function parseCandidateArray(text: string): string[] {
  const stripped = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    const schema = z.array(z.string());
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // JSON 파싱 실패 — 줄 단위 폴백으로 내려간다.
  }
  return stripped
    .split('\n')
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0);
}
