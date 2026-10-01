import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import { isProductionRuntime } from '../../config/runtime-env';
import type { SpeechRecognitionInput, SpeechRecognitionOutcome, SpeechRecognitionProvider } from './speech-recognition-provider.port';

const TranscribeResponseSchema = z.object({
  modelId: z.string().optional(),
  text: z.string(),
  durationMs: z.number().int().nonnegative(),
  empty: z.boolean().optional(),
});

const HealthResponseSchema = z.object({ status: z.enum(['ok', 'loading']), backend: z.string().optional() }).passthrough();

const HEALTH_TIMEOUT_MS = 3000;

/**
 * [신규 No.32] ★ 출구 `SPEECH_LOCAL` — `apps/ml-worker`의 `ML_WORKER_ROLE=speech` 프로세스(voice-ai-설계.md §7.2 · 레지스트리 파일).
 * 오디오는 **원시 바이트 본문**으로 사내 프로세스에만 간다(메모리 → 메모리 · 디스크 0). 리다이렉트는 따라가지 않는다(거버넌스 모드 ON).
 * `modelId`는 공개 응답·관리 상태 어디로도 넘기지 않는다(운영 확인은 ml-worker `/speech/health`).
 * 오디오·글자를 로그에 남기지 않는다(VO-4) — 단계·원인 코드만.
 *
 * `healthy()`: `GET /speech/health` `status === 'ok'`. **운영(`NODE_ENV=production`)이면 `backend === 'mock'`을 사용 불가로 본다**
 * (DD-135 ③ — 가짜 인식 결과의 운영 노출 차단 · 공급자 생성 시 1회 평가).
 */
export class LocalSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly providerId = 'local' as const;
  private readonly logger = new Logger('LocalSpeechRecognitionProvider');
  private readonly production: boolean;
  private warnedMockBackend = false;

  constructor(
    private readonly baseUrl: string,
    env: Record<string, unknown> = process.env,
  ) {
    this.production = isProductionRuntime(env);
  }

  async transcribe(input: SpeechRecognitionInput, opts: { readonly timeoutMs: number }): Promise<SpeechRecognitionOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const url = `${this.baseUrl}/speech/transcribe`;
      assertEgressAllowed('SPEECH_LOCAL', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.audio,
        signal: controller.signal,
        redirect: egressRedirectMode(),
      });
      assertNoRedirectResponse('SPEECH_LOCAL', url, res.status);

      if (res.status === 200) {
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          return { kind: 'FAILED', cause: 'INVALID_RESPONSE' };
        }
        const parsed = TranscribeResponseSchema.safeParse(json);
        if (!parsed.success) return { kind: 'FAILED', cause: 'INVALID_RESPONSE' };
        if (parsed.data.empty === true || parsed.data.text.trim().length === 0) return { kind: 'EMPTY', durationMs: parsed.data.durationMs };
        return { kind: 'OK', text: parsed.data.text, durationMs: parsed.data.durationMs };
      }
      if (res.status === 400) return { kind: 'INVALID_AUDIO' };
      if (res.status === 413) return { kind: 'TOO_LONG' };
      if (res.status === 503) {
        const detail = await readDetail(res);
        if (detail === 'BUSY') return { kind: 'BUSY' };
        return { kind: 'FAILED', cause: 'HTTP_5XX' };
      }
      if (res.status === 504) return { kind: 'FAILED', cause: 'TIMEOUT' };
      return { kind: 'FAILED', cause: 'HTTP_5XX' };
    } catch (err) {
      if (isEgressBlocked(err)) return { kind: 'FAILED', cause: 'EGRESS_BLOCKED' };
      if (controller.signal.aborted) return { kind: 'FAILED', cause: 'TIMEOUT' };
      return { kind: 'FAILED', cause: 'NETWORK' };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthy(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const url = `${this.baseUrl}/speech/health`;
      assertEgressAllowed('SPEECH_LOCAL', url);
      const res = await fetch(url, { signal: controller.signal, redirect: egressRedirectMode() });
      assertNoRedirectResponse('SPEECH_LOCAL', url, res.status);
      if (!res.ok) return false;
      const parsed = HealthResponseSchema.safeParse(await res.json());
      if (!parsed.success || parsed.data.status !== 'ok') return false;
      if (this.production && parsed.data.backend === 'mock') {
        if (!this.warnedMockBackend) {
          this.warnedMockBackend = true;
          this.logger.warn('음성 인식 프로세스가 mock 백엔드입니다 — 운영에서는 사용하지 않습니다.');
        }
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `ML_WORKER_SPEECH_URL`이 없을 때의 안전 수렴 구현(기동 실패 아님 — R-16): 사용 불가. 네트워크 호출 0. */
export class UnconfiguredSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly providerId = 'local' as const;

  async transcribe(): Promise<SpeechRecognitionOutcome> {
    return { kind: 'FAILED', cause: 'NOT_CONFIGURED' };
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}

async function readDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === 'string' ? body.detail : undefined;
  } catch {
    return undefined;
  }
}

function isEgressBlocked(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('EGRESS_BLOCKED ');
}
