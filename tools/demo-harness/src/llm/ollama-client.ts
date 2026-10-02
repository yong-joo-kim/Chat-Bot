// [DT-2] Ollama 공식 API 클라이언트(설계 §11.3 · 정적 검사 H-S6 — Ollama 호출은 이 파일에만). 주소는 루프백만 허용한다.
// 하네스는 Ollama를 설치·기동·종료하지 않는다(FR-0-353). 쓰는 것: 모델 목록 · 적재 목록 · (자기 모델 1개의) 적재·해제.
// 적재 = `POST /api/generate {model, keep_alive}`(프롬프트 없음) · 해제 = `{model, keep_alive: 0}` · 확인 = `GET /api/ps`(2026-10-02 Ollama 0.35.0 실측 X-4).

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

export class OllamaAddressError extends Error {
  constructor(url: string) {
    super(`Ollama 주소는 루프백만 쓸 수 있습니다: ${url}`);
    this.name = 'OllamaAddressError';
  }
}

/** 루프백(127.0.0.1 · localhost · ::1)만 허용 — 아니면 던진다. */
export function assertLoopbackUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new OllamaAddressError(url);
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) throw new OllamaAddressError(url);
  return u;
}

export interface OllamaLoadedModel {
  name: string;
  /** VRAM에 올라간 바이트(`size_vram`). */
  sizeVram: number;
  size: number;
}

export interface OllamaResult {
  ok: boolean;
  ms: number;
  error?: string;
}

export class OllamaClient {
  private readonly base: string;

  constructor(
    baseUrl: string = OLLAMA_DEFAULT_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = assertLoopbackUrl(baseUrl).origin;
  }

  private async json<T>(path: string, init: { method?: string; body?: unknown; timeoutMs: number }): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    const text = await res.text();
    let body: T | null = null;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  }

  /** 서버 응답 · 설치된 모델 이름들(`GET /api/tags`) — 서버가 없으면 reachable=false. */
  async tags(timeoutMs = 3000): Promise<{ reachable: boolean; models: string[] }> {
    try {
      const r = await this.json<{ models?: Array<{ name?: string; model?: string }> }>('/api/tags', { timeoutMs });
      if (!r.ok) return { reachable: false, models: [] };
      return { reachable: true, models: (r.body?.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean) };
    } catch {
      return { reachable: false, models: [] };
    }
  }

  /** 지금 적재된 모델(`GET /api/ps`). 조회 실패면 null. */
  async loaded(timeoutMs = 3000): Promise<OllamaLoadedModel[] | null> {
    try {
      const r = await this.json<{ models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> }>('/api/ps', { timeoutMs });
      if (!r.ok) return null;
      return (r.body?.models ?? []).map((m) => ({ name: m.name ?? m.model ?? '', size: m.size ?? 0, sizeVram: m.size_vram ?? 0 })).filter((m) => m.name);
    } catch {
      return null;
    }
  }

  /** 모델 적재(빈 프롬프트 · 스트림 끔) — 첫 적재는 수 초가 걸린다(상한 기본 60초). */
  async load(model: string, timeoutMs = 60_000, keepAlive = '10m'): Promise<OllamaResult> {
    const t0 = Date.now();
    try {
      const r = await this.json('/api/generate', { method: 'POST', body: { model, keep_alive: keepAlive, stream: false }, timeoutMs });
      return { ok: r.ok, ms: Date.now() - t0, error: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  /** 모델 해제(`keep_alive: 0`) — 실측 응답 7~24ms. */
  async unload(model: string, timeoutMs = 20_000): Promise<OllamaResult> {
    const t0 = Date.now();
    try {
      const r = await this.json('/api/generate', { method: 'POST', body: { model, keep_alive: 0, stream: false }, timeoutMs });
      return { ok: r.ok, ms: Date.now() - t0, error: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  /** 모델이 `/api/ps`에서 나타날 때까지(want=true) 또는 사라질 때까지(want=false) 짧게 폴링한다. */
  async waitLoaded(model: string, want: boolean, timeoutMs: number, wait: (ms: number) => Promise<void>): Promise<boolean> {
    const t0 = Date.now();
    for (;;) {
      const ps = await this.loaded();
      if (ps !== null && ps.some((m) => m.name === model) === want) return true;
      if (Date.now() - t0 >= timeoutMs) return false;
      await wait(250);
    }
  }
}
