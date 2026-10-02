// H-T25(nvidia-smi 파서 · VRAM 회수 판정) · H-T26(Ollama 클라이언트 — 루프백 외 거부 · 적재/해제 본문) · H-S6(호출 위치)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { judgeReclaim, parseComputeAppPids, parseGpuList, parseMemoryCsv } from '../src/gpu/nvidia-smi';
import { assertLoopbackUrl, OllamaAddressError, OllamaClient } from '../src/llm/ollama-client';

test('H-T25: memory CSV 파서 — 정상 · [N/A] · 빈 출력 · 여러 GPU(첫 줄)', () => {
  assert.deepEqual(parseMemoryCsv('1020, 4096\n'), { usedMiB: 1020, totalMiB: 4096 });
  assert.deepEqual(parseMemoryCsv('0, 4096\r\n3000, 8192\r\n'), { usedMiB: 0, totalMiB: 4096 });
  assert.equal(parseMemoryCsv('[N/A], [N/A]'), null);
  assert.equal(parseMemoryCsv(''), null);
  assert.equal(parseMemoryCsv('abc'), null);
  assert.equal(parseMemoryCsv('100, 0'), null);
});

test('H-T25: compute-apps CSV — PID만(WDDM은 used_memory가 [N/A]) · 빈 목록 · 안내 문구', () => {
  assert.deepEqual(parseComputeAppPids('1234, D:\\Python310\\python.exe, [N/A]\r\n5678, C:\\ollama\\llama-server.exe, [N/A]\r\n'), [1234, 5678]);
  assert.deepEqual(parseComputeAppPids(''), []);
  assert.deepEqual(parseComputeAppPids('No running processes found'), []);
  assert.deepEqual(parseGpuList('GPU 0: NVIDIA GeForce RTX 3050 Laptop GPU (UUID: GPU-x)\n\n'), ['GPU 0: NVIDIA GeForce RTX 3050 Laptop GPU (UUID: GPU-x)']);
});

test('H-T25: 회수 판정 — PID 조건(런처+인터프리터 모두 사라짐) ∧ 메모리 조건(증가분의 70% 이상 하락) · 증분 미상 · 관찰 불가', () => {
  const base = { watchedPids: [10, 11], beforeMiB: 2150, increaseMiB: 1000 };
  assert.equal(judgeReclaim({ ...base, appPids: [], usedMiB: 1100 }).ok, true);
  assert.equal(judgeReclaim({ ...base, appPids: [], usedMiB: 1450 }).ok, true, '정확히 70% 하락(2150 - 700)');
  const slow = judgeReclaim({ ...base, appPids: [], usedMiB: 1500 });
  assert.equal(slow.ok, false);
  assert.equal(slow.pidsGone, true);
  assert.equal(slow.memoryOk, false);
  assert.equal(judgeReclaim({ ...base, appPids: [11], usedMiB: 1000 }).pidsGone, false, '인터프리터 PID가 남아 있으면 회수 전');
  assert.equal(judgeReclaim({ ...base, appPids: [99], usedMiB: 1000 }).pidsGone, true, '다른 프로세스는 상관없다');
  // H-1: 증분 0·미상·CPU 구동이면 메모리 하락을 요구하지 않는다(PID 종료만) — 하락 없음이 실패가 되면 안 된다
  assert.equal(judgeReclaim({ ...base, increaseMiB: null, appPids: [], usedMiB: 2000 }).ok, true, '증분 미상 — PID 종료만');
  assert.equal(judgeReclaim({ ...base, increaseMiB: null, appPids: [], usedMiB: 2150 }).ok, true, '증분 미상 · 하락 없음도 통과');
  assert.equal(judgeReclaim({ ...base, increaseMiB: 0, appPids: [], usedMiB: 2150 }).ok, true, '증분 0 · 하락 없음도 통과');
  assert.equal(judgeReclaim({ ...base, increaseMiB: null, appPids: [11], usedMiB: 2150 }).ok, false, '증분 미상이어도 PID가 남으면 실패');
  const cpu = judgeReclaim({ ...base, cpuDevice: true, appPids: [], usedMiB: 2150 });
  assert.equal(cpu.ok, true, 'CPU 구동 — 증분 값이 있어도 메모리 조건 없음');
  assert.ok(cpu.basis.includes('CPU'));
  assert.equal(judgeReclaim({ ...base, cpuDevice: true, appPids: [10], usedMiB: 2150 }).ok, false, 'CPU여도 PID가 남으면 실패');
  assert.equal(judgeReclaim({ ...base, appPids: [], usedMiB: null }).ok, true, '메모리 관찰 불가 — 정책상 PID 조건만');
  assert.ok(judgeReclaim({ ...base, appPids: [], usedMiB: null }).basis.includes('확인 못함'), '관찰 불가는 문구에 밝힌다');
  assert.equal(judgeReclaim({ ...base, appPids: null, usedMiB: 1000 }).ok, true, 'GPU 앱 조회 불가 — 메모리 조건만');
  assert.ok(judgeReclaim({ ...base, appPids: null, usedMiB: 1000 }).basis.includes('확인 못함'));
  assert.equal(judgeReclaim({ ...base, appPids: null, usedMiB: 1500 }).ok, false, '앱 조회 불가여도 증분 있으면 메모리 조건은 적용');
  assert.ok(judgeReclaim({ ...base, appPids: [], usedMiB: 1100 }).basis.includes('2150 -> 1100'));
});

test('H-T26: Ollama 주소는 루프백만 — 그 밖은 생성 시 거부', () => {
  for (const ok of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434']) assert.doesNotThrow(() => assertLoopbackUrl(ok), ok);
  for (const bad of ['http://10.0.0.5:11434', 'http://example.com', 'https://api.openai.com', 'garbage']) assert.throws(() => new OllamaClient(bad), OllamaAddressError, bad);
});

test('H-T26: Ollama 클라이언트 — tags · ps · 적재(keep_alive "10m") · 해제(keep_alive 0) 본문 · 대기', async () => {
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  let loaded = false;
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? (JSON.parse(raw) as { model?: string; keep_alive?: unknown }) : null;
      seen.push({ method: req.method ?? '', url: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen3:4b-instruct-2507-q4_K_M' }, { model: 'gemma3:1b' }] }));
      else if (req.url === '/api/ps') res.end(JSON.stringify({ models: loaded ? [{ name: 'qwen3:4b-instruct-2507-q4_K_M', size: 3525081824, size_vram: 2345297510 }] : [] }));
      else if (req.url === '/api/generate') {
        loaded = body?.keep_alive !== 0;
        res.end(JSON.stringify({ done: true, done_reason: loaded ? 'load' : 'unload' }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const c = new OllamaClient(`http://127.0.0.1:${port}`);
    assert.deepEqual(await c.tags(), { reachable: true, models: ['qwen3:4b-instruct-2507-q4_K_M', 'gemma3:1b'] });
    assert.deepEqual(await c.loaded(), []);
    const l = await c.load('qwen3:4b-instruct-2507-q4_K_M');
    assert.equal(l.ok, true);
    assert.deepEqual(seen.find((s) => s.url === '/api/generate')!.body, { model: 'qwen3:4b-instruct-2507-q4_K_M', keep_alive: '10m', stream: false });
    assert.equal((await c.loaded())?.[0].sizeVram, 2345297510);
    assert.equal(await c.waitLoaded('qwen3:4b-instruct-2507-q4_K_M', true, 1000, async () => undefined), true);
    const u = await c.unload('qwen3:4b-instruct-2507-q4_K_M');
    assert.equal(u.ok, true);
    assert.deepEqual(seen.filter((s) => s.url === '/api/generate')[1].body, { model: 'qwen3:4b-instruct-2507-q4_K_M', keep_alive: 0, stream: false });
    assert.equal(await c.waitLoaded('qwen3:4b-instruct-2507-q4_K_M', false, 1000, async () => undefined), true);
    // 미기동 서버
    const dead = new OllamaClient('http://127.0.0.1:1');
    assert.deepEqual(await dead.tags(500), { reachable: false, models: [] });
    assert.equal(await dead.loaded(500), null);
    assert.equal((await dead.load('x', 500)).ok, false);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});

test('H-S6: Ollama 호출(/api/generate · /api/tags · /api/ps)은 src/llm/ollama-client.ts에만 · nvidia-smi 실행은 src/gpu/ 에만', () => {
  const root = join(__dirname, '..', '..', 'src');
  const ollama: string[] = [];
  const smi: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) {
        const text = readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const rel = relative(root, p).split(sep).join('/');
        if (/['"`]\/api\/(generate|tags|ps)['"`]/.test(text)) ollama.push(rel);
        if (/(spawn|spawnSync|execFile)\w*\(\s*['"]nvidia-smi['"]/.test(text)) smi.push(rel);
      }
    }
  };
  walk(root);
  assert.deepEqual(ollama, ['llm/ollama-client.ts']);
  assert.deepEqual(smi, ['gpu/nvidia-smi.ts']);
});
