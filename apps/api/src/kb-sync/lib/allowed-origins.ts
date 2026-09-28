import { isSameHostPort, urlHostPort } from './url-normalize';

/**
 * [pass 12 · RG-26 · U-5(b)] 허용 출처(순수 — 설계 §6.2 1단계 "포트는 시작 주소에 명시된 것만") — 시작 주소(`seedUrls`)·사이트맵 URL이 가리키는 **host:port**(`new URL().host` — 스킴의 기본 포트
 * 80/443은 빠지므로 `:443` 명시와 생략은 같은 출처다)의 집합. 저장하지 않고 **실행 시점마다** 소스 설정에서 계산한다(`parseSourceRow`) — 설정이 바뀌면(`configVersion`) 다음 tick부터 새 집합이다.
 *
 * `allowedHosts`(호스트 이름 목록 — 저장 형식·겹침 판정·데이터 지도)는 그대로다. 이 집합은 그 위에 "같은 호스트의 **다른 포트**는 다른 서비스일 수 있다"는 좁힘만 더한다:
 * 범위 판정(`isInScope`) · fetcher의 허용 호스트 단계 · 인증 헤더 동행 · 적재 단계 범위 방어가 모두 이 집합을 쓴다. 다른 포트의 문서를 수집하려면 그 포트 URL을 시작 주소나 사이트맵에 넣어야 한다.
 * 시작 주소에 포트가 없으면 그 스킴의 기본 포트(= 포트 없는 host)만 허용한다(`http`↔`https` 상향은 같은 출처라 종전 규칙을 따른다).
 */
export function computeAllowedOrigins(seedUrls: readonly string[], sitemapUrls: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const raw of [...seedUrls, ...sitemapUrls]) {
    const origin = urlHostPort(raw);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

/** URL의 출처(host:port)가 허용 집합에 있는가 — 해석 불가·빈 집합이면 `false`. */
export function isAllowedOrigin(allowedOrigins: readonly string[], url: string): boolean {
  const origin = urlHostPort(url);
  return origin !== '' && allowedOrigins.includes(origin);
}

/**
 * [pass 13 · RG-28] 평문 `http:` 출처 집합(순수) — 시작 주소(`seedUrls`)·사이트맵 URL 중 **`http:` 스킴을 명시한** URL의 host:port. `computeAllowedOrigins`와 같이 저장하지 않고 실행 시점마다 계산한다.
 * `URL.host`는 스킴 기본 포트(80/443)를 지워 `https://a`와 `http://a`가 같은 값이 되므로(범위 판정은 그대로 스킴을 보지 않는다), 인증 헤더가 평문으로 나가도 되는 출처는 이 집합으로 따로 좁힌다.
 * `https:`만 명시한 출처는 여기 들어가지 않는다 — 그 출처의 `http:` URL(링크·사이트맵이 내놓은 것)에는 헤더를 싣지 않는다.
 */
export function computePlainHttpOrigins(seedUrls: readonly string[], sitemapUrls: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const raw of [...seedUrls, ...sitemapUrls]) {
    const origin = urlHostPort(raw);
    if (origin && urlScheme(raw) === 'http:') origins.add(origin);
  }
  return [...origins];
}

function urlScheme(raw: string): string {
  try {
    return new URL(raw).protocol;
  } catch {
    return '';
  }
}

/** 인증 헤더 판정에 필요한 출처 정보 — `ParsedSourceConfig`가 그대로 만족한다. */
export interface AuthOrigins {
  /** 범위용 허용 출처(host:port · 스킴 무관). */
  allowedOrigins: readonly string[];
  /** [pass 13 · RG-28] `http:`를 명시한 시작 주소·사이트맵의 host:port — 평문 요청에 헤더를 실어도 되는 출처. */
  plainHttpOrigins: readonly string[];
}

/**
 * 인증 헤더를 이 요청에 실어도 되는가 — 자격증명은 **시작 주소·사이트맵에 명시된 출처와 정확히 일치할 때만** 나간다(설계 §6.9). 첫 요청(`startUrl` 생략)과 모든 홉이 같은 규칙이다.
 * 홉(≥ 1)은 여기에 더해 **이 문서의 시작 URL과 같은 host:port**여야 한다(pass 10 · RG-24① — 허용 출처가 여러 개여도 리다이렉트로 다른 출처에 자격증명을 옮기지 않는다).
 * **[pass 13 · RG-28]** 요청 URL이 `http:`(평문)이면 같은 host:port의 `http:` URL이 시작 주소·사이트맵에 명시돼 있을 때만 싣는다(`plainHttpOrigins`) — `https://a/`만 등록한 소스가 링크로 발견한
 * `http://a/x`는 범위 안이라 수집될 수는 있어도 헤더는 없다. 홉에서 `https:` 시작 → `http:` 하향도 싣지 않는다(리다이렉트 하향은 §6.4가 이미 거부 — 이중 방어). `http→https` 상향은 유지한다(TLS).
 * 범위 판정(`isAllowedOrigin` · `isInScope`)은 바꾸지 않는다.
 */
export function canSendAuthTo(origins: AuthOrigins, url: string, startUrl?: string): boolean {
  if (!isAllowedOrigin(origins.allowedOrigins, url)) return false;
  if (startUrl !== undefined && !isSameHostPort(startUrl, url)) return false;
  if (urlScheme(url) === 'http:') {
    if (startUrl !== undefined && urlScheme(startUrl) === 'https:') return false;
    return origins.plainHttpOrigins.includes(urlHostPort(url));
  }
  return true;
}
