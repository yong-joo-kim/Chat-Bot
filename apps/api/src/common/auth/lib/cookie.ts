/**
 * 세션 쿠키 파싱/조립 순수 함수(ADR-0014 §2). `cookie-parser` 의존성을 추가하지 않고
 * 표준 포맷을 직접 다룬다(레이트리미터를 자체 구현한 것과 같은 판단, DD-23).
 */

export const SESSION_COOKIE_NAME = 'cb_session';

/** `Cookie` 요청 헤더를 `{name: value}`로 파싱한다. 형식이 어긋난 항목은 건너뛴다. */
export function parseCookieHeader(header?: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const rawValue = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

export interface SetCookieOptions {
  /** 생략하면 브라우저 세션 쿠키. `0`이면 즉시 만료(로그아웃 시 쿠키 제거). */
  maxAgeSec?: number;
  secure: boolean;
  path?: string;
}

/** `Set-Cookie` 헤더 값을 조립한다(NFR-S3 — HttpOnly·SameSite=Lax 고정, 운영만 Secure). */
export function buildSetCookie(value: string, options: SetCookieOptions): string {
  const segments = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? '/api'}`);
  segments.push('HttpOnly');
  segments.push('SameSite=Lax');
  if (options.secure) segments.push('Secure');
  if (options.maxAgeSec !== undefined) segments.push(`Max-Age=${Math.max(0, options.maxAgeSec)}`);
  return segments.join('; ');
}

/** 로그아웃 시 쿠키를 즉시 만료시키는 `Set-Cookie` 값(FR-12-8). */
export function buildClearCookie(secure: boolean, path = '/api'): string {
  return buildSetCookie('', { maxAgeSec: 0, secure, path });
}
