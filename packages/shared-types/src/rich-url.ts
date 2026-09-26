/**
 * [신규 No.46] 리치 메시지(캐러셀) 전용 주소 판정 — **zod 무의존**(RM-4). 브라우저·Node 공통
 * WHATWG `URL`만 쓴다(다른 모듈 값 import 0 — `import type`만 허용). 서버 스키마(`RichHttpsUrlSchema`)·
 * api 설계 점검·콘솔·위젯이 이 판정 1벌을 공유한다(ADR-0043 §7 · `channel-rich-messages-설계.md` §9.1).
 *
 * 기존 `SafeUrlSchema`(`common.ts`)는 http도 허용하고 `@` 형식을 막지 않는다 — **불변**이다. 이 모듈은
 * 새 컴포넌트(캐러셀 카드 이미지·LINK 버튼)에만 적용되는 **더 엄격한** 판정이다.
 */

export const RICH_URL_MAX_LENGTH = 2048;

export type RichUrlError = 'NOT_HTTPS' | 'USERINFO' | 'INVALID_CHARS' | 'TOO_LONG' | 'INVALID';
export type RichUrlWarning = 'PUNYCODE' | 'IP_HOST' | 'SHORTENER';

export const RICH_URL_ERROR_MESSAGES: Record<RichUrlError, string> = {
  TOO_LONG: `주소는 ${RICH_URL_MAX_LENGTH}자 이하여야 합니다.`,
  INVALID_CHARS: '주소에 공백·제어 문자·역슬래시를 쓸 수 없습니다.',
  NOT_HTTPS: 'https 주소만 쓸 수 있습니다.',
  USERINFO: "주소에 '@'가 포함된 형식은 쓸 수 없습니다(다른 사이트로 보내는 속임수에 쓰입니다).",
  INVALID: '주소 형식을 확인해 주세요.',
};

/** 저장 허용(경고만) — 선택 목록, 운영자 판단을 돕는 참고용(비차단). */
export const KNOWN_URL_SHORTENER_HOSTS: readonly string[] = [
  'bit.ly',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'han.gl',
  'me2.do',
  'url.kr',
  'vo.la',
  'naver.me',
  'buly.kr',
];

export type RichUrlInspection = { ok: true; host: string; warnings: RichUrlWarning[] } | { ok: false; error: RichUrlError };

const CONTROL_OR_BACKSLASH_RE = /[\u0000-\u001F\u007F\\]/;
const HTTPS_PREFIX_RE = /^https:\/\//i;

/** `//` 뒤 첫 `/`·`?`·`#` 전까지(권한부)에 리터럴 `@`가 있는지 검사한다(경로·쿼리의 `@`는 허용). */
function authorityHasAt(url: string): boolean {
  const afterScheme = url.slice(url.indexOf('//') + 2);
  const end = afterScheme.search(/[/?#]/);
  const authority = end === -1 ? afterScheme : afterScheme.slice(0, end);
  return authority.includes('@');
}

/**
 * 새 컴포넌트 URL 판정 순서(`channel-rich-messages-설계.md` §9.1):
 * ① 길이 ② 제어 문자·공백·역슬래시 ③ `https://` 접두(대소문자 무관) ④ 권한부의 `@`(퍼센트 인코딩
 * 우회는 파서 이중 검사) ⑤ `new URL()` 파싱·스킴·호스트 유효성 + 파서 `username`/`password` ⑥ 경고
 * (퓨니코드·IP 호스트·알려진 단축 URL — 저장은 허용).
 */
export function inspectRichUrl(url: string): RichUrlInspection {
  if (url.length > RICH_URL_MAX_LENGTH) return { ok: false, error: 'TOO_LONG' };
  if (CONTROL_OR_BACKSLASH_RE.test(url) || /\s/.test(url)) return { ok: false, error: 'INVALID_CHARS' };
  if (!HTTPS_PREFIX_RE.test(url)) return { ok: false, error: 'NOT_HTTPS' };
  if (authorityHasAt(url)) return { ok: false, error: 'USERINFO' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'INVALID' };
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) return { ok: false, error: 'INVALID' };
  if (parsed.username.length > 0 || parsed.password.length > 0) return { ok: false, error: 'USERINFO' };

  const host = parsed.hostname.toLowerCase();
  const warnings: RichUrlWarning[] = [];
  if (host.split('.').some((label) => label.startsWith('xn--'))) warnings.push('PUNYCODE');
  if (isIpHost(host)) warnings.push('IP_HOST');
  if (KNOWN_URL_SHORTENER_HOSTS.includes(host)) warnings.push('SHORTENER');

  return { ok: true, host, warnings };
}

function isIpHost(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6 리터럴
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** `inspectRichUrl(url).ok`의 얇은 래퍼(위젯 렌더 시 재검증 — 서버 우회 주입 방어). */
export function isSafeRichUrl(url: string): boolean {
  return inspectRichUrl(url).ok;
}

/** 허용 도메인 목록 매칭(소문자 비교 — 호스트는 이미 정규화돼 있다고 가정). */
export function hostMatchesRules(host: string, rules: readonly { host: string; includeSubdomains: boolean }[]): boolean {
  const lower = host.toLowerCase();
  return rules.some((r) => lower === r.host || (r.includeSubdomains && lower.endsWith(`.${r.host}`)));
}
