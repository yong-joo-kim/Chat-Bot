/**
 * [신규 No.43] 인코딩 판정·디코딩(순수 — §7.5 · FR-KB2-9). ① `Content-Type` charset → ② BOM →
 * ③ 앞 4KB의 `<meta charset>`/`http-equiv` → ④ UTF-8. 대체 문자(U+FFFD) 비율 > 2%면 UTF-8로 재시도.
 */
function sniffMetaCharset(head: string): string | null {
  const metaCharset = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(head);
  if (metaCharset) return metaCharset[1];
  const httpEquiv = /<meta[^>]+http-equiv=["']?content-type["'][^>]*content=["'][^"']*charset=([a-z0-9_-]+)/i.exec(head);
  if (httpEquiv) return httpEquiv[1];
  return null;
}

function normalizeLabel(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === 'ks_c_5601-1987' || l === 'x-windows-949' || l === 'ksc5601' || l === 'cp949') return 'euc-kr';
  return l;
}

function replacementRatio(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  for (const ch of text) if (ch === '�') count += 1;
  return count / text.length;
}

export function decodeBody(bytes: Uint8Array, contentTypeHeader: string | null): string {
  let label: string | null = null;
  if (contentTypeHeader) {
    const m = /charset=([^;]+)/i.exec(contentTypeHeader);
    if (m) label = m[1].trim().replace(/^["']|["']$/g, '');
  }
  if (!label) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = 'utf-8';
    else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  }
  if (!label) {
    const headBytes = bytes.subarray(0, Math.min(bytes.length, 4096));
    const head = new TextDecoder('utf-8', { fatal: false }).decode(headBytes);
    label = sniffMetaCharset(head);
  }
  label = label ? normalizeLabel(label) : 'utf-8';

  let decoded: string;
  try {
    decoded = new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (label !== 'utf-8' && replacementRatio(decoded) > 0.02) {
    const retry = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (replacementRatio(retry) < replacementRatio(decoded)) decoded = retry;
  }
  return decoded;
}

/** 최종 디코딩 결과의 대체 문자 비율이 너무 높으면 `ENCODING` 제외 대상이다. */
export function isEncodingUnsafe(decoded: string): boolean {
  return replacementRatio(decoded) > 0.02;
}
