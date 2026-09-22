/**
 * CORS 경로 분기 판정(DD-48, ADR-0014 §4). 공개 API(`/api/v1/public/*`)와 `/api/health`는
 * 이 판정으로 현행 동작(`origin:'*', credentials:false`)을 100% 보존한다. 관리자 경로만
 * `ADMIN_WEB_ORIGIN` allowlist + `credentials`를 연다. ADR-0011 §5의 "CORS는 인가 수단이
 * 아니다" 원칙은 유지된다 — 공개 API의 실제 인가는 `PublicOriginGuard`가 한다.
 *
 * ⚠ `setGlobalPrefix('api')` + URI 버저닝(ADR-0003)에 의존하는 경로 문자열이다.
 * 프리픽스/버저닝 방식이 바뀌면 이 정규식도 함께 바뀌어야 한다.
 */
export function isPublicSurface(url: string): boolean {
  return /^\/api\/(v1\/public\/|health)/.test(url);
}
