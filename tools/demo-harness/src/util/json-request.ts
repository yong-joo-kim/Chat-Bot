// 얇은 HTTP 도우미 — 헬스 확인·API 호출용. 전역 fetch(Node 20+) 사용, 시간 제한은 AbortSignal.

export interface HttpResult<T = unknown> {
  status: number;
  ok: boolean;
  body: T | null;
  text: string;
  headers: Headers;
}

export async function httpJson<T = unknown>(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 5000),
  });
  const text = await res.text();
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body, text, headers: res.headers };
}
