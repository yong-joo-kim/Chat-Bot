/**
 * [No.26] 응답 판정(§7.5) — Content-Type 판정 · JSON 파싱(reviver 없음). DB·Nest·네트워크 무의존(NFR-LM1).
 */

/** `application/json` 또는 `+json`로 끝나는 MIME(파라미터 허용, 예: `application/json; charset=utf-8`). */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return mime === 'application/json' || mime.endsWith('+json');
}

export type JsonParseResult = { ok: true; json: unknown } | { ok: false };

/** `JSON.parse`(reviver 없음). 빈 본문·파싱 실패는 `ok:false`. */
export function parseJsonBody(text: string): JsonParseResult {
  if (!text || text.trim().length === 0) return { ok: false };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
