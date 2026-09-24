import { API_CONNECTION_LIMITS } from '@chat-bot/shared-types';

/**
 * [No.26] 연결 규칙 순수 함수(DB·Nest 무의존, NFR-LM1). `baseUrl` 형식·금지 헤더명·`secretRef` 형식은
 * `packages/shared-types/src/legacy-api.ts`(zod)가 이미 단일 소스다 — 이 파일은 저장 시점에 서비스가
 * 계산해야 하는 파생값(기본 레이트리밋)만 담는다.
 */

/** 개인정보 조회형 연결의 기본 레이트리밋은 더 낮다(P-14, §3.5). */
export function resolveDefaultRateLimit(personalDataLookup: boolean): number {
  return personalDataLookup ? API_CONNECTION_LIMITS.rateLimitPersonalDataDefault : API_CONNECTION_LIMITS.rateLimitDefault;
}

/** 저장값이 환경변수 상한보다 크면 호출 시 `min()`을 적용한다(§3.5 `LEGACY_API_MAX_TIMEOUT_MS`). */
export function resolveEffectiveTimeoutMs(storedTimeoutMs: number, envMaxTimeoutMs: number): number {
  return Math.min(storedTimeoutMs, envMaxTimeoutMs);
}

/** `baseUrl`의 호스트만 추출한다(감사 스냅샷 `baseUrlHost`·목록 표시 공용). */
export function extractHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** 스킴이 `http`인지(비보안 경고 `insecureHttp` 파생, §4.1). */
export function isInsecureHttp(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'http:';
  } catch {
    return false;
  }
}
