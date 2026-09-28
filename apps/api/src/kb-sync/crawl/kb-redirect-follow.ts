import { normalizeUrl } from '../lib/url-normalize';
import { isInScope } from '../lib/scope-match';
import type { ScopeConfig } from '../lib/scope-match';
import { resolveRedirect, shouldStopRedirect } from '../lib/redirect-policy';
import type { KbFetchRequest, KbFetchResult } from './kb-crawl-http.fetcher';

/**
 * [pass 6 · RG-16] 리다이렉트 추종 공용 헬퍼(§6.4) — 크롤러(문서 · 사이트맵 · robots.txt)와 적재기(재수집)가 **같은 규칙**을 쓴다. 예전에는 크롤러 안에만 있어
 * 적재 단계 재수집(`fetchOnce`)이 3xx를 따르지 못해 `/docs` → `/docs/` 같은 문서가 영원히 적재되지 못했다.
 *
 * 규칙: 최대 3회 · 순환 중단 · `https → http` 하향 거부 · **홉마다** 범위(허용 호스트·경로 접두·제외·쿼리)·출구·주소를 다시 검증(범위는 여기서, 출구·주소는
 * `fetchOnce`가 요청마다). 범위 밖·하향·4번째 홉·순환은 `REDIRECT_OUT_OF_SCOPE`다(요청 자체가 나가지 않는다). 홉 요청 직전·직후의 페이싱·robots 확인은 호출부가
 * 훅(`beforeRequest`·`afterRequest`)으로 끼운다.
 */
export interface RedirectFetcher {
  fetchOnce(req: KbFetchRequest): Promise<KbFetchResult>;
}

export type RedirectOutReason = 'SCOPE' | 'DOWNGRADE' | 'MAX_HOPS' | 'LOOP';

export type FollowResult =
  | (Extract<KbFetchResult, { kind: 'RESPONSE' }> & { finalUrl: string })
  | Extract<KbFetchResult, { kind: 'BLOCKED' }>
  | Extract<KbFetchResult, { kind: 'ERROR' }>
  /** `target` = 따라가지 않은 다음 홉의 URL(있을 때만 — 스킴 하향은 해석하지 않는다). 호출부가 "여러 URL이 한 목적지로 수렴"(인증 벽 · RG-21)을 세는 데 쓴다. */
  | { kind: 'REDIRECT_OUT_OF_SCOPE'; reason: RedirectOutReason; target?: string }
  /**
   * 호출부 훅이 이 요청을 미뤘다(조각 예산 소진 등) — 문서는 그대로 두고 다음 조각에 다시 시도한다. [pass 9 · M-4] `resume` = 홉 ≥ 1에서 미뤘을 때의 진행 상태(다음 홉 URL · 홉 번호 · 방문한 URL) —
   * 호출부가 저장했다가 다음 조각에 `FollowRequest.resume`으로 넘기면 홉 0을 다시 요청하지 않고 그 홉에서 이어간다(호스트 간격이 조각 예산보다 커도 진행한다). 홉 0에서 미뤘으면 없다.
   */
  | { kind: 'DEFERRED'; resume?: FollowResume }
  /** 호출부 훅이 이 요청을 거부했다(리다이렉트 대상이 robots로 막힘 등) — `reason`은 호출부가 정한다. */
  | { kind: 'VETOED'; reason: 'ROBOTS_BLOCKED' };

/** [pass 9 · M-4] 리다이렉트 추종 재개 상태 — 이미 나간 앞 홉을 다시 요청하지 않고 `url`(홉 `hop`)부터 이어간다. */
export interface FollowResume {
  /** 다음에 요청할 홉의 URL. */
  url: string;
  /** 그 홉 번호(≥ 1) — 최대 3회 규칙이 이어진다. */
  hop: number;
  /** 지금까지 방문한 URL(순환 검사 — `url` 포함). */
  visited: readonly string[];
}

export interface FollowRequest {
  url: string;
  /** [pass 9 · M-4] 있으면 `url`이 아니라 이 상태에서 이어 시작한다(호출부가 같은 시작 URL·같은 실행에서 저장한 상태만 넘긴다). */
  resume?: FollowResume;
  allowedHosts: readonly string[];
  /** [pass 12 · RG-26] 허용 출처(host:port) — fetcher가 요청마다 확인한다(범위 재검사는 `opts.scope.allowedOrigins`). */
  allowedOrigins: readonly string[];
  /** 응답 상한(바이트) — 함수면 요청 URL·홉마다 정한다(예: HTML 2MB · 문서 파일은 소스 파일 상한 — 리다이렉트로 종류가 바뀌어도 그 홉의 URL 기준). */
  maxBytes: number | ((url: string, hop: number) => number);
  /** 요청 타임아웃(ms) — 함수면 요청 URL·홉마다 정한다(문서 파일은 ×4). */
  timeoutMs: number | ((url: string, hop: number) => number);
  /** 홉별 요청 헤더 — 조건부 요청·인증 헤더를 어느 홉에 실을지는 호출부가 정한다(자격증명은 시작 호스트에만). */
  headersFor: (url: string, hop: number) => Record<string, string>;
}

export interface FollowOptions {
  allowQueryUrls: boolean;
  /** 홉마다 다시 검증할 범위(깊이는 0으로 본다). */
  scope: ScopeConfig;
  /** 매 요청(첫 요청 포함) 직전 — `null`이면 진행, 결과를 돌려주면 그 결과로 끝낸다. */
  beforeRequest?: (url: string, hop: number) => Promise<FollowResult | null>;
  /** 매 응답(오류 포함) 직후 — 호스트 페이서 해제 등. */
  afterRequest?: (url: string, hop: number, result: KbFetchResult) => void;
}

export async function fetchFollowingRedirects(fetcher: RedirectFetcher, req: FollowRequest, opts: FollowOptions): Promise<FollowResult> {
  // [pass 11 · L-C] 재개 상태의 홉 URL은 미룰 때(최대 30분 전) 한 번 검증한 값이다 — 그 사이 범위 설정(호스트·경로 접두·제외·쿼리 허용)이 좁혀졌을 수 있어 **재개 때 다시 검사**한다. 범위 밖이면 그 홉을
  // 요청하지 않고 새 리다이렉트 홉이 범위 밖일 때와 같은 결과(`REDIRECT_OUT_OF_SCOPE` · SCOPE · 대상 = 그 URL)로 끝낸다 — 홉 0부터 다시 요청하면 요청이 늘고 결과도 같다. (SSRF·주소 검증·robots·페이싱·
  // 임대 갱신은 재개해도 요청마다 다시 수행된다.)
  if (req.resume) {
    const normalized = normalizeUrl(req.resume.url, { allowQueryUrls: opts.allowQueryUrls });
    if (!normalized || !isInScope(normalized, 0, opts.scope)) return { kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE', target: req.resume.url };
  }
  let current = req.resume?.url ?? req.url;
  const visited = new Set<string>(req.resume ? [...req.resume.visited, current] : [current]);
  for (let hop = req.resume?.hop ?? 0; ; hop += 1) {
    if (opts.beforeRequest) {
      const gate = await opts.beforeRequest(current, hop);
      if (gate) {
        // 홉 ≥ 1에서 미뤘으면 앞 홉의 요청은 이미 나갔다 — 다음 조각이 이 자리에서 이어가도록 상태를 돌려준다.
        if (gate.kind === 'DEFERRED' && hop > 0) return { kind: 'DEFERRED', resume: { url: current, hop, visited: [...visited] } };
        return gate;
      }
    }
    let result: KbFetchResult;
    try {
      result = await fetcher.fetchOnce({
        url: current,
        allowedHosts: req.allowedHosts,
        allowedOrigins: req.allowedOrigins,
        headers: req.headersFor(current, hop),
        maxBytes: typeof req.maxBytes === 'function' ? req.maxBytes(current, hop) : req.maxBytes,
        timeoutMs: typeof req.timeoutMs === 'function' ? req.timeoutMs(current, hop) : req.timeoutMs,
      });
    } catch (e) {
      // 전송 계층이 예외를 던져도 요청 직전 훅이 잡은 자원(호스트 페이서)은 반드시 풀어 준다 — 그러지 않으면 그 호스트가 영원히 잠긴다.
      opts.afterRequest?.(current, hop, { kind: 'ERROR', outcome: 'NETWORK_ERROR' });
      throw e;
    }
    opts.afterRequest?.(current, hop, result);
    if (result.kind === 'BLOCKED' || result.kind === 'ERROR') return result;
    if (result.kind === 'RESPONSE') return { ...result, finalUrl: current };

    // REDIRECT — 다음 홉을 계산하고 범위를 다시 검증한다.
    const decision = resolveRedirect(current, result.location);
    if (!decision.ok) {
      if (decision.reason === 'SCHEME_DOWNGRADE') return { kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'DOWNGRADE' };
      return { kind: 'ERROR', outcome: 'NETWORK_ERROR' }; // Location 없음·해석 불가 — 사이트 오류(일시)로 본다.
    }
    if (hop >= 3) return { kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'MAX_HOPS', target: decision.url };
    if (shouldStopRedirect(hop, visited, decision.url)) return { kind: 'REDIRECT_OUT_OF_SCOPE', reason: visited.has(decision.url) ? 'LOOP' : 'MAX_HOPS', target: decision.url };
    const normalized = normalizeUrl(decision.url, { allowQueryUrls: opts.allowQueryUrls });
    if (!normalized || !isInScope(normalized, 0, opts.scope)) return { kind: 'REDIRECT_OUT_OF_SCOPE', reason: 'SCOPE', target: decision.url };
    visited.add(decision.url);
    current = decision.url;
  }
}
