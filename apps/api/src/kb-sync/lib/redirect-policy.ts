/**
 * [신규 No.43] 리다이렉트 정책(순수 — §6.4 · C-8). 전송 계층은 3xx를 그대로 돌려주고(선택 필드
 * `redirectMode:'REPORT'`), 이 파일이 다음 홉을 계산한다. 범위·출구 재검증은 호출부(fetcher)가
 * `scope-match`·`checkEgress`로 매 단계 다시 수행한다.
 */
export type RedirectDecision = { ok: true; url: string } | { ok: false; reason: 'NO_LOCATION' | 'SCHEME_DOWNGRADE' | 'INVALID_URL' };

export function resolveRedirect(currentUrl: string, location: string | undefined): RedirectDecision {
  if (!location) return { ok: false, reason: 'NO_LOCATION' };
  let current: URL;
  let next: URL;
  try {
    current = new URL(currentUrl);
    next = new URL(location, current);
  } catch {
    return { ok: false, reason: 'INVALID_URL' };
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return { ok: false, reason: 'INVALID_URL' };
  if (current.protocol === 'https:' && next.protocol === 'http:') return { ok: false, reason: 'SCHEME_DOWNGRADE' };
  return { ok: true, url: next.toString() };
}

export const MAX_REDIRECT_HOPS = 3;

/** 최대 홉 초과 또는 이미 방문한 URL로 돌아오는 순환이면 중단한다. */
export function shouldStopRedirect(hopCount: number, visited: ReadonlySet<string>, nextUrl: string): boolean {
  return hopCount >= MAX_REDIRECT_HOPS || visited.has(nextUrl);
}
