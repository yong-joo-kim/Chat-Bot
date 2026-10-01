// 제품 API 클라이언트 — 실제 `POST /auth/login`으로 받은 세션 쿠키를 계정별로 메모리에만 보관한다(디스크 0 · NFR-DHS3).
// 모든 응답은 JSON 파싱 후 반환하고, 오류는 코드·상세가 든 ApiError로 던진다(원인이 보고서에 남도록).
import type { ZodTypeAny } from 'zod';
import type { Redactor } from '../util/redact';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  form?: FormData;
  headers?: Record<string, string>;
  /** 이 상태 코드는 오류로 보지 않는다. */
  allow?: number[];
  /** 2xx 외 응답도 던지지 않고 그대로 반환한다. */
  raw?: boolean;
  timeoutMs?: number;
}

export interface ApiResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

export class ApiSession {
  private cookie: string | null = null;

  constructor(
    /** 예: `http://127.0.0.1:3000/api/v1` */
    readonly baseUrl: string,
    readonly label: string,
    private readonly redactor?: Redactor,
  ) {}

  /** 현재 세션 쿠키 값(`cb_session` 값만) — 브라우저에 주입할 때만 쓴다. 로그·보고서에 쓰지 않는다. */
  get sessionValue(): string | null {
    if (!this.cookie) return null;
    const m = /^cb_session=(.*)$/.exec(this.cookie);
    return m ? decodeURIComponent(m[1]) : null;
  }

  get isLoggedIn(): boolean {
    return this.cookie !== null;
  }

  async login(email: string, password: string): Promise<{ id: string; name: string; role: string; mustChangePassword: boolean }> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(`로그인 실패(${email}): 상태 ${res.status}`, res.status, safeJson(text)?.code, 'POST', '/auth/login', safeJson(text));
    }
    const setCookie = res.headers.getSetCookie();
    const raw = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('cb_session='));
    if (!raw) throw new ApiError('로그인 응답에 세션 쿠키가 없습니다', res.status, undefined, 'POST', '/auth/login', text);
    this.cookie = raw;
    this.redactor?.register(decodeURIComponent(raw.slice('cb_session='.length)));
    const body = safeJson(text) as { user: { id: string; name: string; role: string; mustChangePassword?: boolean } };
    return { id: body.user.id, name: body.user.name, role: body.user.role, mustChangePassword: body.user.mustChangePassword ?? false };
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
    const qs = opts.query
      ? '?' +
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let body: string | FormData | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${this.baseUrl}${path}${qs}`, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
    const text = await res.text();
    const parsed = text ? safeJson(text) ?? text : undefined;
    const ok = res.ok || (opts.allow?.includes(res.status) ?? false);
    if (!ok && !opts.raw) {
      const code = typeof parsed === 'object' && parsed !== null ? (parsed as { code?: string }).code : undefined;
      const msg = typeof parsed === 'object' && parsed !== null ? (parsed as { message?: string }).message : undefined;
      const details = typeof parsed === 'object' && parsed !== null ? JSON.stringify((parsed as { details?: unknown }).details ?? '').slice(0, 300) : '';
      const err = `${this.label} ${method} ${path} -> ${res.status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}${details && details !== '""' ? ` ${details}` : ''}`;
      throw new ApiError(this.redactor ? this.redactor.redact(err) : err, res.status, code, method, path, parsed);
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, opts);
  }
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, opts);
  }
}

function safeJson(text: string): (Record<string, unknown> & { code?: string }) | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown> & { code?: string };
  } catch {
    return undefined;
  }
}

/** 생성 전에 shared-types zod 스키마로 본문을 검증한다(제품 규칙 위반을 서버 왕복 전에 잡는다). 서버에는 원본 본문을 보낸다. */
export function assertValid<T extends ZodTypeAny>(schema: T, payload: unknown, label: string): void {
  const r = schema.safeParse(payload);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`데이터셋 정의 오류(${label}): ${issues}`);
  }
}
