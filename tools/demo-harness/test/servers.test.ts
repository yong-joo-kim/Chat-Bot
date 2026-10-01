// 하네스 정적 서버: 정적 서빙 · SPA 대체 · 경로 탈출 차단 · /api 역프록시(Set-Cookie 그대로 · X-Forwarded-* 없음 · 스트리밍 본문) · 무대 템플릿
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillTemplate, isSafeSlug, escapeHtml, startStageServer } from '../src/servers/stage-server';
import { mimeOf, resolveStaticFile, startStaticServer, type RunningServer } from '../src/servers/static-server';
import { startHarnessServers } from '../src/servers';
import { repoPaths } from '../src/config';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dh-srv-'));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(root, 'dist', 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'SECRET');
  return root;
}

test('MIME: 확장자별 · 알 수 없으면 octet-stream', () => {
  assert.ok(mimeOf('a.html').startsWith('text/html'));
  assert.ok(mimeOf('a.js').startsWith('text/javascript'));
  assert.ok(mimeOf('a.css').startsWith('text/css'));
  assert.equal(mimeOf('a.xyz'), 'application/octet-stream');
});

test('경로 해석: 루트 밖 탈출 · 널 문자 · 잘못된 인코딩 차단', () => {
  const root = fixture();
  try {
    const dist = join(root, 'dist');
    assert.ok(resolveStaticFile(dist, '/index.html'));
    assert.ok(resolveStaticFile(dist, '/'));
    assert.equal(resolveStaticFile(dist, '/../secret.txt'), null);
    assert.equal(resolveStaticFile(dist, '/%2e%2e/secret.txt'), null);
    assert.equal(resolveStaticFile(dist, '/..%5Csecret.txt'), null);
    assert.equal(resolveStaticFile(dist, '/a%00b'), null);
    assert.equal(resolveStaticFile(dist, '/%E0%A4%A'), null);
    assert.equal(resolveStaticFile(dist, '/missing.js'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('정적 서버: 파일 서빙 · SPA 대체(확장자 없는 경로만) · 404 · HEAD · POST 405 · 127.0.0.1 바인드', async () => {
  const root = fixture();
  const port = await freePort();
  const srv = await startStaticServer({ name: 't', root: join(root, 'dist'), port, spaFallback: true });
  try {
    const idx = await get(port, '/');
    assert.equal(idx.status, 200);
    assert.ok(idx.body.includes('<title>app</title>'));
    assert.ok(String(idx.headers['content-type']).startsWith('text/html'));
    const js = await get(port, '/assets/app.js');
    assert.equal(js.body, 'console.log(1)');
    const spa = await get(port, '/chatbots/abc/dashboard');
    assert.equal(spa.status, 200);
    assert.ok(spa.body.includes('<title>app</title>'));
    assert.equal((await get(port, '/assets/missing.js')).status, 404); // 확장자 있는 누락은 SPA 대체 금지
    const esc = await get(port, '/..%2Fsecret.txt');
    assert.ok(esc.status !== 200 && !esc.body.includes('SECRET'));
    const head = await get(port, '/', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal((await get(port, '/', {}, 'POST')).status, 405);
    assert.ok(srv.requestCount >= 6);
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('역프록시: /api/* 를 대상으로 전달 — 메서드·본문·Set-Cookie 그대로, X-Forwarded-* 없음, Host는 대상', async () => {
  const seen: { method?: string; url?: string; headers: IncomingMessage['headers']; body: string }[] = [];
  const upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': ['cb_session=abc; Path=/api; HttpOnly; SameSite=Lax', 'x=1'] });
      res.end(JSON.stringify({ echoed: Buffer.concat(chunks).toString('utf8') }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = (upstream.address() as { port: number }).port;
  const root = fixture();
  const port = await freePort();
  const srv = await startStaticServer({ name: 'c', root: join(root, 'dist'), port, spaFallback: true, proxy: { prefix: '/api', target: { host: '127.0.0.1', port: upPort } } });
  try {
    const res = await new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/auth/login?x=1', method: 'POST', headers: { 'content-type': 'application/json', cookie: 'cb_session=old' } }, (r) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(c).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ email: 'a@b.c' }));
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.headers['set-cookie'], ['cb_session=abc; Path=/api; HttpOnly; SameSite=Lax', 'x=1']);
    assert.equal(JSON.parse(res.body).echoed, '{"email":"a@b.c"}');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/api/v1/auth/login?x=1');
    assert.equal(seen[0].headers.cookie, 'cb_session=old');
    assert.equal(seen[0].headers.host, `127.0.0.1:${upPort}`);
    for (const h of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip']) assert.equal(seen[0].headers[h], undefined, h);
    // /apix 는 프록시 대상이 아니다(접두 경계)
    assert.equal((await get(port, '/apix/foo')).status, 200); // SPA 대체
    assert.equal(seen.length, 1);
  } finally {
    await srv.close();
    await new Promise<void>((r) => upstream.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('역프록시: 대상이 죽어 있으면 502(JSON 안내)', async () => {
  const dead = await freePort();
  const root = fixture();
  const port = await freePort();
  const srv = await startStaticServer({ name: 'c', root: join(root, 'dist'), port, proxy: { prefix: '/api', target: { host: '127.0.0.1', port: dead } } });
  try {
    const r = await get(port, '/api/health');
    assert.equal(r.status, 502);
    assert.ok(JSON.parse(r.body).message.includes('API 서버에 연결할 수 없습니다'));
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('같은 포트에 두 번 바인드하면 실패한다(포트 충돌은 시작 오류)', async () => {
  const port = await freePort();
  const a = await startStaticServer({ name: 'a', port });
  try {
    await assert.rejects(startStaticServer({ name: 'b', port }));
  } finally {
    await a.close();
  }
});

test('템플릿 치환: HTML 이스케이프 · 없는 이름은 빈 문자열 · 슬러그 검증', () => {
  assert.equal(fillTemplate('<a href="{{URL}}">{{NAME}}</a>{{MISSING}}', { URL: 'http://x/?a=1&b="2"', NAME: '<b>' }), '<a href="http://x/?a=1&amp;b=&quot;2&quot;">&lt;b&gt;</a>');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(isSafeSlug('gaon-market-1'), true);
  for (const bad of [null, '', '../x', 'a b', '"><script>', 'A', '-x']) assert.equal(isSafeSlug(bad as string | null), false, String(bad));
});

test('무대 서버: /stage · /site?bot= 라우트에 값을 채운다 · 안전하지 않은 슬러그는 비운다 · 템플릿 없으면 404', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-stage-'));
  writeFileSync(join(dir, 'stage.html'), '<p id="c">{{CONSOLE_URL}}</p>');
  writeFileSync(join(dir, 'site.html'), '<script data-chatbot="{{BOT_SLUG}}" src="{{WIDGET_URL}}/widget.js"></script>');
  const port = await freePort();
  let srv: RunningServer | null = null;
  try {
    srv = await startStageServer({ port, assetsDir: dir, values: () => ({ CONSOLE_URL: 'http://localhost:5173', WIDGET_URL: 'http://localhost:5174' }) });
    assert.equal((await get(port, '/stage')).body, '<p id="c">http://localhost:5173</p>');
    assert.ok((await get(port, '/site?bot=gaon-1')).body.includes('data-chatbot="gaon-1"'));
    assert.ok((await get(port, '/site?bot=%22%3E%3Cscript%3E')).body.includes('data-chatbot=""'));
    assert.equal((await get(port, '/site')).body.includes('data-chatbot=""'), true);
    assert.equal((await get(port, '/system')).status, 404);
  } finally {
    await srv?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('하네스 서버 3개: 포트 일괄 오프셋으로 시작·종료(실제 제품 dist 사용), 종료 후 포트 해제', async () => {
  const paths = repoPaths();
  const base = 20000 + Math.floor(Math.random() * 20000);
  const moved = { api: base, console: base + 1, widget: base + 2, mlWorker: base + 3, stage: base + 4 };
  const snippet = `<script src="http://localhost:${moved.widget}/widget.js" data-chatbot="demo" data-api-base="http://localhost:${moved.api}/api/v1"></script>`;
  const s = await startHarnessServers(paths, moved, { bots: () => ({ demo: { name: '데모', snippet } }) });
  try {
    const stage = await get(moved.stage, '/stage');
    assert.equal(stage.status, 200);
    assert.ok(stage.body.includes(`http://localhost:${moved.console}`), '무대 템플릿에 오프셋된 콘솔 주소');
    const site = await get(moved.stage, '/site?bot=demo');
    assert.ok(site.body.includes(`http://localhost:${moved.widget}/widget.js`));
    assert.ok(site.body.includes(`data-api-base="http://localhost:${moved.api}/api/v1"`));
    assert.equal((await get(moved.console, '/')).status, 200);
    assert.equal((await get(moved.widget, '/widget.js')).status, 200);
    assert.equal((await get(moved.widget, '/widget.js')).headers['access-control-allow-origin'], '*');
    assert.equal((await get(moved.console, '/api/health')).status, 502); // API 없음 -> 프록시 502
  } finally {
    await s.closeAll();
  }
  const { isPortFree } = await import('../src/proc/ports');
  for (const p of Object.values(moved)) assert.equal(await isPortFree(p), true, `포트 ${p}`);
});

test('하네스 서버: 한 포트가 점유돼 있으면 이미 연 서버를 닫고 던진다(부분 기동 없음)', async () => {
  const paths = repoPaths();
  const base = 40000 + Math.floor(Math.random() * 10000);
  const moved = { api: base, console: base + 1, widget: base + 2, mlWorker: base + 3, stage: base + 4 };
  const blocker = createServer();
  await new Promise<void>((r) => blocker.listen(moved.widget, '127.0.0.1', r));
  try {
    await assert.rejects(startHarnessServers(paths, moved));
    const { isPortFree } = await import('../src/proc/ports');
    assert.equal(await isPortFree(moved.console), true, '먼저 연 콘솔 서버가 닫혀야 한다');
  } finally {
    await new Promise<void>((r) => blocker.close(() => r()));
  }
});
