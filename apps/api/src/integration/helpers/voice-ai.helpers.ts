import * as http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiResponse } from './ai-guardrails.harness';

/** 음성 AI(No.32) 통합 시험 공용 — 원시 오디오 본문 요청 · 골든 정규화 · 시험용 제어 가능한 공급자. */

export interface RawResponse<T = unknown> extends ApiResponse<T> {
  raw: string;
}

/** `Content-Length` 없이(청크 전송) 또는 지정해서 원시 바이트 본문을 보낸다. */
export function rawPost<T = unknown>(url: string, body: Buffer | Buffer[], headers: Record<string, string>, opts: { chunked?: boolean } = {}): Promise<RawResponse<T>> {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname, search } = new URL(url);
    const chunks = Array.isArray(body) ? body : [body];
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const req = http.request(
      { method: 'POST', hostname, port, path: pathname + search, headers: { ...(opts.chunked ? {} : { 'Content-Length': String(total) }), ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T, raw: data });
        });
      },
    );
    req.on('error', (e) => {
      // 서버가 413 응답 뒤 연결을 닫으면 클라이언트 쓰기가 EPIPE/ECONNRESET이 될 수 있다 — 응답이 없으면 오류로 전달한다.
      reject(e);
    });
    for (const c of chunks) req.write(c);
    req.end();
  });
}

export const GOLDEN_PATH = join(__dirname, 'voice-ai-golden.json');

export function loadGolden(): Record<string, string> {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, string>;
}

/** 골든 캡처 시험과 같은 정규화(동적 값 → 자리표시자). */
export function normalizeBody(raw: string, subs: Array<[string, string]>): string {
  let out = raw;
  for (const [from, to] of subs) out = out.split(from).join(to);
  return out
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>');
}
