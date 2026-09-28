/**
 * [신규 No.43] URL 정규화(순수 — §6.7) — 스킴·호스트 소문자 · 기본 포트 제거 · 프래그먼트 제거 ·
 * 경로 `.`/`..` 정리(WHATWG `URL`이 처리) · 퍼센트 인코딩 대문자화 · 쿼리 매개변수 정렬 ·
 * `allowQueryUrls=false`면 쿼리가 있는 URL은 제외(null 반환).
 */
export interface NormalizeUrlOptions {
  allowQueryUrls: boolean;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

function upperCasePercentEncoding(s: string): string {
  return s.replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());
}

/** 실패(스킴 오류·사용자정보·쿼리 있는데 허용 안 됨)면 `null`. */
export function normalizeUrl(raw: string, options: NormalizeUrlOptions): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  const hasQuery = url.search.length > 0;
  if (hasQuery && !options.allowQueryUrls) return null;

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if (url.port && url.port === DEFAULT_PORTS[url.protocol]) url.port = '';

  if (hasQuery) {
    const params = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
    url.search = '';
    for (const [k, v] of params) url.searchParams.append(k, v);
  }

  let pathname = upperCasePercentEncoding(url.pathname);
  if (pathname === '') pathname = '/';
  url.pathname = pathname;

  return url.toString();
}

export function urlHostname(normalized: string): string {
  return new URL(normalized).hostname;
}

/**
 * [pass 10 · RG-24①] 호스트 + **명시된 비기본 포트**(`new URL().host` — 스킴의 기본 포트 80/443은 빠진다). 인증 헤더 동행 판정에 쓴다: 같은 호스트 이름이어도 포트가 다르면 다른 서비스일 수 있어
 * 자격증명을 싣지 않는다. `http://a` → `https://a`(둘 다 기본 포트)는 같은 값이라 상향 홉은 헤더를 유지한다. 해석 불가면 빈 문자열(어느 것과도 같지 않은 값이 아니라 "비교 불가" — 호출부는 빈 값끼리를 같다고 보지 않는다).
 */
export function urlHostPort(raw: string): string {
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return '';
  }
}

/** [pass 10 · RG-24①] 리다이렉트 홉이 시작 URL과 같은 출처(호스트 + 기본 포트 정규화 후 포트)인가 — 인증 헤더를 실을지 정한다. */
export function isSameHostPort(startUrl: string, hopUrl: string): boolean {
  const a = urlHostPort(startUrl);
  return a !== '' && a === urlHostPort(hopUrl);
}

/** 표시용 — 호스트+경로(+쿼리 있으면 "?…" 표식만, R-26 유사 규칙). */
export function displayUrl(normalized: string): string {
  const u = new URL(normalized);
  return `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
}
