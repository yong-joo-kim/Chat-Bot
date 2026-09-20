export interface IpSourceRequest {
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * 클라이언트 IP 산출(§8.6). `TRUST_PROXY=false`(기본)면 소켓 주소, `true`면
 * `X-Forwarded-For`의 가장 왼쪽 값을 쓴다 — 무조건 헤더를 신뢰하면 IP 기준 제한이
 * 헤더 조작으로 무력화될 수 있으므로 명시적 opt-in으로 둔다.
 */
export function resolveClientIp(req: IpSourceRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value) {
      const first = value.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
