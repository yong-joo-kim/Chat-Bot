/** Origin 정규화(순수, §8.7) — 소문자화 + 기본 포트(80/443) 제거 + 후행 슬래시 제거 후 완전 일치 비교한다. */
export function normalizeOrigin(origin: string): string {
  let value = origin.trim().toLowerCase();
  value = value.replace(/\/$/, '');
  value = value.replace(/^(https?):\/\/([^/]+):(80|443)$/, (_m, scheme: string, host: string, port: string) => {
    if ((scheme === 'http' && port === '80') || (scheme === 'https' && port === '443')) {
      return `${scheme}://${host}`;
    }
    return _m;
  });
  return value;
}

/** `allowedOrigins`가 비어 있으면 모든 출처를 허용한다(FR-11-9). */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return true; // 서버 간 호출·동일 출처 — CORS로 보호되는 대상이 아니다(§8.7).
  const normalized = normalizeOrigin(origin);
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
}
