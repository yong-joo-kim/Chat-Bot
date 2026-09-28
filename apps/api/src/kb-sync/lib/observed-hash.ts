import { sha256Hex } from './content-fingerprint';
import { urlHash } from './external-file-name';
import { normalizeUrl } from './url-normalize';

/**
 * [신규 No.43 — pass 8 · RG-21 · pass 9 · H-1] 인증 벽 판정용 "수렴 지문"(`KbDocument.observedHash`)을 만드는 순수 함수 모음(§8.4).
 *
 * 값의 종류(원문은 저장하지 않는다 — 해시뿐):
 * - 본문 해시(접두 없음) — 정규화 본문의 sha256. **본문이 빈 문자열이면 남기지 않는다**(이미지·iframe 전용 페이지가 전부 `sha256('')`으로 같은 해시가 되는 충돌 방지).
 * - `RL:` + 최종 URL(호스트·경로 — **쿼리 제외**) 해시 — 리다이렉트 원래 행이고 **최종 목적지가 로그인 류 신호**(경로·호스트에 login·signin·sso·auth 등)를 가진다. 인증 만료 시 모든 페이지가 로그인 화면으로 수렴하는 벽의 신호.
 *   [pass 11 · M-B] 로그인 URL이 `/login?next=/docs/pN`처럼 페이지마다 다른 return 파라미터를 달고 있어도 같은 지문이 되도록 쿼리를 뺀다(`X:`와 같은 규칙).
 * - `RD:` + 최종 URL 해시 — [pass 11 · M-B] 리다이렉트를 따라 **로그인 신호가 있는 목적지**에 도달해 그 자리에서 기록된 목적지 행. 원래 행(`RL:`)이 이미 "로그인으로 수렴"을 분포에 세므로 목적지 행은 분자·분모 어디에도
 *   세지 않는다(쿼리 허용 소스에서 원래 행 12개 + 목적지 행 12개가 분모를 이중으로 부풀려 벽이 0.48로 희석되던 문제). 본문 해시는 남기지 않는다.
 * - `R:` + 최종 URL 해시 — 리다이렉트 원래 행(목적지에 로그인 신호 없음). 정상 통합·개편(`/v1/*` → `/latest/`)은 서로 다른 옛 URL이 한 곳으로 수렴하지만 벽이 아니므로 **분포에서 뺀다**.
 *   원래 행의 표식으로만 남긴다(FULL_RESEND 대상에서 원본 행을 빼는 데도 쓴다 — L-4).
 * - `X:` + 범위 밖 목적지의 호스트·경로 해시 — 로그인 신호가 있는 목적지일 때만 남긴다(SSO 로그인 수렴).
 */
export const REDIRECT_ORIGIN_PREFIX = 'R:';
export const REDIRECT_LOGIN_PREFIX = 'RL:';
export const REDIRECT_TARGET_PREFIX = 'RD:';
export const OUT_OF_SCOPE_PREFIX = 'X:';

/**
 * 소문자 URL 문자열에서 로그인 류 신호를 찾는다.
 * - 짧은 단어(sso·auth·cas 등)는 **경로 조각(`/`로 나눈 한 칸)·호스트 라벨** 안의 단어 경계에서만(`lesson`의 `sso` · `author`의 `auth`는 신호가 아니다). [pass 11 · L-A] 하이픈으로 이어진 여러 단어 조각에
 *   문서·해설 성격의 단어(`guide`·`setup`·`studies` 등)가 함께 있으면(`/docs/sso-setup-guide` · `/docs/auth-guide` · `/docs/cas-studies/x`) 로그인 의미가 아닌 문서 경로로 보고 신호로 세지 않는다. 단독 조각(`/sso/…` · `/cas/login` ·
 *   `/auth/callback` · `sso.example`)과 문서 단어가 없는 이어진 조각(`/auth-callback` · `/auth.do`)은 종전대로 신호다 — 미탐을 늘리지 않는다.
 * - 긴 단어(login·logon·한국어 `로그인`·`j_spring_security_check` 등 대표 로그인 처리 경로)는 부분 일치(`loginForm`·`login.do`).
 * - `signin`은 `-ing` 단어(`designing`·`assigning`·`signing`)의 부분 문자열이므로 뒤에 `g`가 이어지면 제외한다(`signinForm`·`signin.do`는 유지). `sign-in`·`sign_in`·`log-in`·`log_in`은 앞에 영문자가 이어지면(`design-in-practice`)
 *   제외한다.
 */
const LOGIN_TOKENS = new Set(['sso', 'auth', 'oauth', 'oauth2', 'saml', 'saml2', 'cas', 'idp', 'adfs', 'okta', 'authenticate', 'authorize', 'signon']);
const LOGIN_SUBSTRINGS = ['login', 'logon', '로그인', '로그온', 'j_spring_security_check', 'j_security_check', 'j_acegi_security_check'];
const LOGIN_PATTERNS: readonly RegExp[] = [/signin(?!g)/, /(?<![a-z])(?:sign|log)[-_]in/];
/** 하이픈 등으로 이어진 조각에 이 단어가 함께 있으면 로그인 URL이 아니라 문서·해설 경로로 본다. */
const DOC_WORDS = new Set([
  'guide', 'guides', 'setup', 'study', 'studies', 'tutorial', 'tutorials', 'overview', 'intro', 'introduction', 'faq', 'howto', 'how', 'what', 'why', 'docs', 'doc', 'documentation', 'manual',
  'reference', 'concept', 'concepts', 'example', 'examples', 'practice', 'practices', 'policy', 'policies', 'config', 'configuration', 'integration', 'integrations', 'architecture', 'design',
  'blog', 'news', 'release', 'releases', 'notes', 'changelog', 'about', 'best', 'tips', 'tip', 'basics', 'basic', 'case', 'cases', 'story', 'stories', 'article', 'articles', 'post', 'posts',
  'lesson', 'lessons', 'training', 'course', 'courses', 'learn', 'getting', 'started',
]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function hasLoginSignal(url: string): boolean {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = safeDecode(u.pathname).toLowerCase();
  } catch {
    return false;
  }
  const text = `${host}${path}`;
  if (LOGIN_SUBSTRINGS.some((s) => text.includes(s))) return true;
  if (LOGIN_PATTERNS.some((re) => re.test(text))) return true;
  for (const piece of [...host.split('.'), ...path.split('/')]) {
    const words = piece.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.some((w) => LOGIN_TOKENS.has(w))) continue;
    if (words.length === 1 || !words.some((w) => DOC_WORDS.has(w))) return true;
  }
  return false;
}

/** 본문 해시 — 본문이 비어 있으면(공백뿐 포함) `undefined`(관측하지 않는다). */
export function bodyObservedHash(normalizedText: string): string | undefined {
  return normalizedText.trim().length === 0 ? undefined : sha256Hex(normalizedText);
}

/** 호스트·경로만(쿼리·프래그먼트 제외) — 로그인 URL의 페이지별 return 파라미터를 지문에서 뺀다. */
function hostPathKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase()}${u.pathname}`;
  } catch {
    return url;
  }
}

/** 리다이렉트 원래 행의 지문 — 목적지에 로그인 신호가 있으면 `RL:`(호스트·경로 해시 — 분포에 센다), 없으면 `R:`(원래 행 표식 · 분포에서 뺀다). */
export function redirectOriginHash(finalUrl: string, allowQueryUrls: boolean): string {
  if (hasLoginSignal(finalUrl)) return `${REDIRECT_LOGIN_PREFIX}${urlHash(hostPathKey(finalUrl))}`;
  const normalized = normalizeUrl(finalUrl, { allowQueryUrls }) ?? finalUrl;
  return `${REDIRECT_ORIGIN_PREFIX}${urlHash(normalized)}`;
}

/** [pass 11 · M-B] 로그인 신호가 있는 목적지에 리다이렉트로 도달해 기록하는 목적지 행의 지문(`RD:`) — 원래 행(`RL:`)이 이미 분포에 세어지므로 목적지 행은 분포에서 뺀다. */
export function redirectLoginTargetHash(finalUrl: string): string {
  return `${REDIRECT_TARGET_PREFIX}${urlHash(hostPathKey(finalUrl))}`;
}

/** 범위 밖 리다이렉트 행의 지문 — 목적지에 로그인 신호가 있을 때만(`X:` + 호스트·경로 해시 — 쿼리 제외). 없으면 `undefined`. */
export function outOfScopeTargetHash(target: string): string | undefined {
  if (!hasLoginSignal(target)) return undefined;
  try {
    const u = new URL(target);
    return `${OUT_OF_SCOPE_PREFIX}${urlHash(`${u.host.toLowerCase()}${u.pathname}`)}`;
  } catch {
    return `${OUT_OF_SCOPE_PREFIX}${urlHash(target)}`;
  }
}

/** 리다이렉트 원래 행의 지문인가(`R:` · `RL:`). */
export function isRedirectOriginHash(hash: string | null | undefined): boolean {
  return !!hash && (hash.startsWith(REDIRECT_ORIGIN_PREFIX) || hash.startsWith(REDIRECT_LOGIN_PREFIX));
}

/** 로그인 목적지 행의 지문인가(`RD:`) — 방문 HTML 분모에서도 뺀다. */
export function isRedirectTargetHash(hash: string | null | undefined): boolean {
  return !!hash && hash.startsWith(REDIRECT_TARGET_PREFIX);
}

/** 이 지문이 "한 곳으로 수렴" 분포의 분자·하한에 세어지는가 — 정상 통합 리다이렉트의 원래 행(`R:`)과 로그인 목적지 행(`RD:` — 원래 행 `RL:`이 대신 센다)은 세지 않는다. */
export function countsTowardConvergence(hash: string | null | undefined): boolean {
  return !!hash && !hash.startsWith(REDIRECT_ORIGIN_PREFIX) && !hash.startsWith(REDIRECT_TARGET_PREFIX);
}
