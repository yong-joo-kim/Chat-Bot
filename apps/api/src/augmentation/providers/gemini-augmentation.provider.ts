import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { maskPii } from '@chat-bot/pii-mask';
import { EgressBlockedError, assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import { AUGMENT_GEMINI_DEFAULT_BASE_URL } from '../../common/egress/egress-registry';
import { AUGMENTATION_SYSTEM_INSTRUCTION, buildAugmentationUserContent } from '../lib/gemini-prompt';
import { AugmentationFailureCause, AugmentationGenerateInput, AugmentationGenerateOutcome, AugmentationProvider } from './augmentation-provider.port';
import { AugmentationCircuit, CircuitOutcome, classifyCircuitFailure } from './lib/augmentation-circuit';

/** 기동 검사(§6.4)와 같은 상수를 쓴다(`common/egress/egress-registry.ts`) — export(§6.1 표). */
const DEFAULT_BASE_URL = AUGMENT_GEMINI_DEFAULT_BASE_URL;
const DEFAULT_MODEL = 'gemini-2.0-flash';

export interface GeminiAugmentationConfig {
  readonly apiKey: string; // 팩토리가 빈 값이면 이 provider를 아예 만들지 않는다(DD-97).
  readonly model?: string;
  readonly baseUrl?: string; // 사내 프록시·게이트웨이 주입용(하드코딩 금지 원칙).
  readonly timeoutMs?: number;
  /** 주입 회로 없이 만들 때만 쓰는 자체 회로 설정(기본 5회 · 60초). 팩토리는 공급자별 공유 회로(`circuit`)를 주입한다. */
  readonly circuitFailureThreshold?: number;
  readonly circuitOpenMs?: number;
  /** [K-1c] 팩토리가 소유한 공급자별 공유 회로 — Provider는 Job마다 새로 만들어지므로 상태를 여기에 둔다. 없으면 자기 회로(현행 호환). */
  readonly circuit?: AugmentationCircuit;
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

/** 호출 중 원인을 분류해 던지는 내부 오류 — `generateWithOutcome()`의 catch가 원인 코드로 바꾼다(밖으로 새지 않는다). */
class GeminiCallError extends Error {
  constructor(
    readonly failure: AugmentationFailureCause,
    readonly httpStatus?: number,
  ) {
    super(`GEMINI_CALL_FAILED cause=${failure}`);
  }
}

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
  private readonly circuit: AugmentationCircuit;

  constructor(private readonly config: GeminiAugmentationConfig) {
    this.circuit =
      config.circuit ??
      new AugmentationCircuit({
        threshold: config.circuitFailureThreshold ?? 5,
        openMs: config.circuitOpenMs ?? 60_000,
        onTransition: (event, info) => {
          if (event === 'OPENED') this.logger.warn(`Gemini 연속 실패 ${info.failures}회 — ${info.openMs}ms 동안 회로를 엽니다.`);
        },
      });
  }

  /** `generateWithOutcome()`의 후보만 돌려주는 얇은 위임 — 계약(C-1)·서명 불변. */
  async generate(input: AugmentationGenerateInput): Promise<readonly string[]> {
    return (await this.generateWithOutcome(input)).candidates;
  }

  /**
   * 실패 원인 분류(K-1b §2.3) — 예외를 던지지 않는다. 확인 순서는 DD-99 5단계(PII → 금지어 → 타임아웃 → 회로차단)에 맞춘다:
   * 시드 마스킹·금지어 검사가 회로 확인보다 앞이라 시드 차단은 탐침을 소모하지 않고 회로 상태도 바꾸지 않는다(K-1c).
   * 회로에는 인프라 실패(타임아웃·네트워크·5xx·429)만 계수한다 — 계약 오류(4xx)·형식 오류·출구 차단은 장애가 아니다.
   */
  async generateWithOutcome(input: AugmentationGenerateInput): Promise<AugmentationGenerateOutcome> {
    if (!this.config.apiKey) return this.fail('NOT_CONFIGURED'); // 방어적 이중 확인(C-1)

    const maskedSeeds = input.seeds.map((s) => maskPii(s).maskedText);
    const banned = this.config.bannedWords ?? [];
    if (maskedSeeds.some((s) => banned.some((w) => w && s.includes(w)))) {
      // 시드 자체에 금지어가 있으면 외부로 내보내지 않는다(FR-L1-6 강제 경로 ②).
      return this.fail('SEED_BLOCKED');
    }

    const permit = this.circuit.tryAcquire();
    if (!permit) return this.fail('CIRCUIT_OPEN');

    let outcome: CircuitOutcome = 'neutral';
    try {
      const candidates = await this.callGemini(maskedSeeds, input.targetCount);
      outcome = 'success';
      return { candidates };
    } catch (e) {
      let cause: AugmentationFailureCause;
      if (e instanceof GeminiCallError) {
        cause = e.failure;
        outcome = classifyCircuitFailure(e.failure, e.httpStatus);
      } else if (e instanceof EgressBlockedError) {
        cause = 'EGRESS_BLOCKED';
        outcome = 'neutral';
      } else {
        cause = 'NETWORK';
        outcome = 'infra';
      }
      return this.fail(cause);
    } finally {
      this.circuit.record(permit, outcome); // 탐침 누수 방지 — 어떤 경로든 반드시 기록한다.
    }
  }

  private fail(failure: AugmentationFailureCause): AugmentationGenerateOutcome {
    this.logger.warn(`Gemini 호출 실패 — G1 폴백 대상: cause=${failure}`);
    return { candidates: [], failure };
  }

  /** 공유 회로를 **읽기만** 한다(탐침 소모 없음) — 개방 중이면 false라 capability가 UNHEALTHY를 보고한다(K-1c). */
  async healthy(): Promise<boolean> {
    return !!this.config.apiKey && !this.circuit.isOpen();
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
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
    } catch (e) {
      if (e instanceof EgressBlockedError) throw e;
      throw new GeminiCallError(timedOut ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new GeminiCallError(res.status >= 400 && res.status < 500 ? 'HTTP_4XX' : 'HTTP_5XX', res.status);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new GeminiCallError('INVALID_RESPONSE');
    }
    const parsed = GeminiResponseSchema.safeParse(json);
    if (!parsed.success) throw new GeminiCallError('INVALID_RESPONSE');

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
