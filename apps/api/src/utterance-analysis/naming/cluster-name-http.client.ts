import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { assertEgressAllowed, assertNoRedirectResponse, egressRedirectMode } from '../../common/egress/egress-guard';
import type { ClusterNameSuggester, ClusterNameSuggestInput } from './cluster-name-suggester.port';

const ClusterLabelResponseSchema = z.object({
  modelId: z.string(),
  label: z.string().nullable(),
});

export interface ClusterNameHttpConfig {
  /** `AUGMENTATION_LOCAL_BASE_URL` — 팩토리가 미설정 시 이 클라이언트를 만들지 않는다. */
  readonly baseUrl: string;
  /** 호출 1회 시간 제한(`UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS`). */
  readonly timeoutMs: number;
}

/**
 * ★ 이름 제안 **출구 파일**(No.21 — 설계서 §16.3 · DC-11) — ml-worker 생성 프로파일의 `POST /cluster-label`을
 * 호출한다. 출구 클래스 `AUGMENT_LOCAL`(레지스트리 `files`에 이 파일을 추가 — 새 클래스 0)이며 `fetch(` 직전에
 * `assertEgressAllowed('AUGMENT_LOCAL', url)`를 호출하고 리다이렉트를 따라가지 않는다(`egressRedirectMode()` ·
 * `assertNoRedirectResponse()`).
 *
 * `apps/api`는 이 클라이언트 1개로만 이름 제안을 안다 — 모델·서빙 엔진·프롬프트 규칙을 알지 못한다.
 * 실패·비200·응답 스키마 불일치·시간 초과는 전부 `null`이다(이름 제안 실패는 분석 실패가 아니다 — NFR-DCR3).
 * 로그에는 키워드·문장을 남기지 않는다(DC-9 — 오류 종류만).
 */
export class ClusterNameHttpClient implements ClusterNameSuggester {
  readonly suggesterId = 'local' as const;
  private readonly logger = new Logger('ClusterNameHttpClient');

  constructor(private readonly config: ClusterNameHttpConfig) {}

  async suggest(input: ClusterNameSuggestInput, signal: AbortSignal): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const url = `${this.config.baseUrl}/cluster-label`;
      assertEgressAllowed('AUGMENT_LOCAL', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [...input.keywords], samples: [...input.samples], locale: 'ko' }),
        signal: controller.signal,
        redirect: egressRedirectMode(),
      });
      assertNoRedirectResponse('AUGMENT_LOCAL', url, res.status);
      if (!res.ok) return null;
      const parsed = ClusterLabelResponseSchema.safeParse(await res.json());
      if (!parsed.success) return null;
      return parsed.data.label;
    } catch (e) {
      // 종류만 남긴다 — 예외 message에 URL·본문이 섞일 수 있어 담지 않는다.
      this.logger.warn(`묶음 이름 제안 호출 실패: ${e instanceof Error ? e.constructor.name : 'unknown'}`);
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}
