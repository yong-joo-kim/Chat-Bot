// 하네스 내부 정적 서버(설계 §6.1 · DHD-3) — node:http만 사용. 제품 빌드 산출물(dist)을 그대로 서빙하고,
// 콘솔 서버는 `/api/*`를 API로 역프록시한다(운영 배포 형태 "정적 파일 + /api 역프록시"와 같음 · X-Forwarded-* 없음).
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** 루트 아래 실제 파일 경로로 안전하게 해석(경로 탈출 차단). 파일이 아니면 null. */
export function resolveStaticFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rootAbs = resolve(root);
  const candidate = resolve(join(rootAbs, normalize(decoded)));
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) return null;
  try {
    const st = statSync(candidate);
    if (st.isFile()) return candidate;
    if (st.isDirectory()) {
      const idx = join(candidate, 'index.html');
      return existsSync(idx) ? idx : null;
    }
  } catch {
    /* 없음 */
  }
  return null;
}

export interface ProxyTarget {
  host: string;
  port: number;
}

export interface StaticServerOptions {
  name: string;
  /** 서빙 루트(제품 dist). 없으면 정적 서빙 없이 `routes`·프록시만. */
  root?: string;
  host?: string;
  port: number;
  /** 확장자 없는 GET 경로에 index.html을 돌려주는 SPA 대체. */
  spaFallback?: boolean;
  /** 이 접두로 시작하는 요청은 역프록시(예: `/api`). */
  proxy?: { prefix: string; target: ProxyTarget };
  /** 모든 응답에 붙일 헤더(예: 위젯 서버의 CORS). */
  headers?: Record<string, string>;
  /** 정적 서빙보다 먼저 처리하는 사용자 라우트 — true를 돌려주면 처리 완료. */
  route?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;
}

export interface RunningServer {
  name: string;
  port: number;
  close(): Promise<void>;
  /** 처리한 요청 수(시험·진단용). */
  readonly requestCount: number;
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, target: ProxyTarget, extra: Record<string, string>): void {
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  const upstream = httpRequest(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...extra });
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', ...extra });
    }
    res.end(JSON.stringify({ message: `API 서버에 연결할 수 없습니다(${target.host}:${target.port}) - ${e.message}` }));
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

export function startStaticServer(opts: StaticServerOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  const sockets = new Set<Socket>();
  let count = 0;
  const extra = opts.headers ?? {};

  const server: Server = createServer(async (req, res) => {
    count++;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (opts.proxy && (url.pathname === opts.proxy.prefix || url.pathname.startsWith(opts.proxy.prefix + '/'))) {
        proxyRequest(req, res, opts.proxy.target, extra);
        return;
      }
      if (opts.route && (await opts.route(req, res, url))) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', ...extra });
        res.end();
        return;
      }
      if (!opts.root) {
        res.writeHead(404, extra);
        res.end();
        return;
      }
      let file = resolveStaticFile(opts.root, url.pathname);
      if (!file && opts.spaFallback && extname(url.pathname) === '') {
        file = resolveStaticFile(opts.root, '/index.html');
      }
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...extra });
        res.end('Not Found');
        return;
      }
      const type = mimeOf(file);
      res.writeHead(200, {
        'content-type': type,
        'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
        ...extra,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', ...extra });
      res.end(`서버 오류: ${(e as Error).message}`);
    }
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen({ port: opts.port, host, exclusive: true }, () => {
      server.off('error', reject);
      resolveP({
        name: opts.name,
        port: opts.port,
        get requestCount() {
          return count;
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            for (const s of sockets) s.destroy();
          }),
      });
    });
  });
}
