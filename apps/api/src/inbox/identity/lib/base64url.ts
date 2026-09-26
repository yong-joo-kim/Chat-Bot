/** [신규 No.42] base64url 순수 유틸(§6.2) — 라이브러리 없이 `Buffer` 표준 API만 사용한다. */

const BASE64URL_CHARS = /^[A-Za-z0-9_-]+$/;

export function isBase64UrlString(s: string): boolean {
  return s.length > 0 && BASE64URL_CHARS.test(s);
}

export function base64UrlDecode(s: string): Buffer | null {
  if (!isBase64UrlString(s)) return null;
  try {
    return Buffer.from(s, 'base64url');
  } catch {
    return null;
  }
}

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}
