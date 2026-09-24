/**
 * [No.26] 요청 조립 — 유일하게 `ValidatedLegacyRequest`를 만들 수 있는 파일(★ §7.2 · §13 L-3).
 * DB·Nest·네트워크 무의존 순수 함수(NFR-LM1). 호스트 해석은 WHATWG `URL`로만 한다.
 */

const VALIDATED_LEGACY_REQUEST_BRAND: unique symbol = Symbol('ValidatedLegacyRequest');

export interface ValidatedLegacyRequest {
  readonly [VALIDATED_LEGACY_REQUEST_BRAND]: true;
  readonly url: string;
  readonly hostname: string;
  readonly protocol: 'http:' | 'https:';
  readonly port: string;
  readonly method: 'GET' | 'POST';
  readonly bodyJson: string | null;
}

export interface BuildRequestInput {
  /** 연결에 저장된 기준 URL(스킴+호스트+포트+기준 경로). */
  baseUrl: string;
  method: 'GET' | 'POST';
  /** 치환 전 템플릿(예: "/orders/{0}"). */
  pathTemplate: string;
  /** 자리표시자 순서대로 이미 마스킹이 끝난 값. */
  pathValues: readonly string[];
  query: ReadonlyArray<{ name: string; value: string }>;
  /** POST 본문 필드(마스킹 완료 값) — GET이면 무시한다. */
  body: ReadonlyArray<{ field: string; value: string }>;
}

export type BuildRequestResult = { ok: true; request: ValidatedLegacyRequest } | { ok: false; outcome: 'BLOCKED_URL' };

const PLACEHOLDER_RE = /\{([0-4])\}/g;

function isBlockedPathValue(v: string): boolean {
  if (v.length === 0) return true;
  let decoded = v;
  try {
    decoded = decodeURIComponent(v);
  } catch {
    // 디코딩 실패 문자열은 원본으로 비교한다.
  }
  const lower = decoded.toLowerCase();
  return lower === '.' || lower === '..';
}

function substitutePath(template: string, values: readonly string[]): string | null {
  let blocked = false;
  const substituted = template.replace(PLACEHOLDER_RE, (_m, idxStr: string) => {
    const idx = Number(idxStr);
    const value = values[idx] ?? '';
    if (isBlockedPathValue(value)) {
      blocked = true;
      return '';
    }
    return encodeURIComponent(value);
  });
  return blocked ? null : substituted;
}

function setNested(target: Record<string, unknown>, path: string, value: string): void {
  const segments = path.split('.');
  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const existing = cur[seg];
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1]] = value;
}

function buildBodyObject(fields: ReadonlyArray<{ field: string; value: string }>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) setNested(obj, f.field, f.value);
  return obj;
}

/**
 * URL 조립·인코딩·재파싱 검증(§7.2). 실패(경로 이탈·호스트 변경·CRLF·`.`/`..`)는 `BLOCKED_URL`.
 * 성공 시에만 이 파일 밖에서 만들 수 없는 브랜드 객체를 반환한다(FR-0-99, §13 L-3).
 */
export function buildLegacyRequest(input: BuildRequestInput): BuildRequestResult {
  let base: URL;
  try {
    base = new URL(input.baseUrl);
  } catch {
    return { ok: false, outcome: 'BLOCKED_URL' };
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return { ok: false, outcome: 'BLOCKED_URL' };

  const substitutedPath = substitutePath(input.pathTemplate, input.pathValues);
  if (substitutedPath === null) return { ok: false, outcome: 'BLOCKED_URL' };
  if (/[\r\n\0]/.test(substitutedPath)) return { ok: false, outcome: 'BLOCKED_URL' };

  const basePath = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  const fullPath = `${basePath}${substitutedPath}`;
  if (fullPath.includes('//') || fullPath.split('/').some((seg) => seg === '..')) {
    return { ok: false, outcome: 'BLOCKED_URL' };
  }

  const queryString = input.query.map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`).join('&');
  const assembled = `${base.protocol}//${base.host}${fullPath}${queryString ? `?${queryString}` : ''}`;

  let reparsed: URL;
  try {
    reparsed = new URL(assembled);
  } catch {
    return { ok: false, outcome: 'BLOCKED_URL' };
  }

  if (
    reparsed.protocol !== base.protocol ||
    reparsed.hostname !== base.hostname ||
    reparsed.port !== base.port ||
    reparsed.pathname !== fullPath ||
    reparsed.username !== '' ||
    reparsed.password !== ''
  ) {
    return { ok: false, outcome: 'BLOCKED_URL' };
  }

  const bodyJson = input.method === 'POST' && input.body.length > 0 ? JSON.stringify(buildBodyObject(input.body)) : input.method === 'POST' ? '{}' : null;

  const request: ValidatedLegacyRequest = {
    [VALIDATED_LEGACY_REQUEST_BRAND]: true,
    url: reparsed.toString(),
    hostname: reparsed.hostname,
    protocol: reparsed.protocol as 'http:' | 'https:',
    port: reparsed.port,
    method: input.method,
    bodyJson,
  };
  return { ok: true, request };
}
