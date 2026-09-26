/**
 * 위젯은 식별 토큰의 서명을 검증하지 않는다(서버만 검증한다, ADR-0042 §6.2) — `sub` 변경 감지
 * 용도로만 페이로드를 디코드한다(`omnichannel-inbox-설계.md` §6.8 "sub 변경 규칙"). 파싱에 실패하면
 * 예외를 던지지 않고 `undefined`를 반환한다(위조·손상된 토큰도 안전하게 무시).
 */
/** 서버 헤더 상한과 동일(`INBOX_LIMITS.identityHeaderMaxBytes`, `omnichannel-inbox-설계.md` §6.1) —
 * 위젯은 shared-types 런타임 값을 쓰지 않으므로(ADR-0012) 값만 복제한다(코드 리뷰 R1 Low). */
const MAX_TOKEN_LENGTH = 2048;

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

export function decodeIdentitySub(token: string): string | undefined {
  try {
    if (token.length > MAX_TOKEN_LENGTH) return undefined;
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const json = base64UrlDecode(parts[1]);
    const payload: unknown = JSON.parse(json);
    if (payload !== null && typeof payload === 'object' && typeof (payload as Record<string, unknown>).sub === 'string') {
      return (payload as { sub: string }).sub;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
