// 사전 점검 판정(설계 §5.1) — 순수 판정 함수와 .env 키 이름 해석
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evalDependencies,
  evalDevDb,
  evalDisk,
  evalDistOutputs,
  evalEnvKeys,
  evalFfmpeg,
  evalGit,
  evalGpuInfo,
  evalMemory,
  evalModelCache,
  evalNetwork,
  evalNode,
  evalOllama,
  evalPnpm,
  evalPorts,
  evalVenv,
  evalBrowserProbe,
  parseEnvKeyNames,
} from '../src/preflight/checks';
import { hfHubDir, playwrightBrowsersPath } from '../src/preflight';

const GB = 1024 ** 3;

test('PC-1 Node 20 이상 통과, 미만 차단(3요소)', () => {
  assert.equal(evalNode('v24.19.0').status, 'pass');
  assert.equal(evalNode('v20.0.0').status, 'pass');
  const old = evalNode('v18.19.0');
  assert.equal(old.status, 'block');
  assert.ok(old.why && old.how);
});

test('PC-1 pnpm: npm_execpath 없으면 경고', () => {
  assert.equal(evalPnpm('C:\\pnpm\\pnpm.cjs').status, 'pass');
  assert.equal(evalPnpm(undefined).status, 'warn');
});

test('PC-2/3 의존성·venv 차단', () => {
  assert.equal(evalDependencies([]).status, 'pass');
  const d = evalDependencies(['playwright-core']);
  assert.equal(d.status, 'block');
  assert.ok(d.how!.includes('pnpm install'));
  assert.equal(evalVenv(true, 'x').status, 'pass');
  const v = evalVenv(false, 'C:\\venv\\python.exe');
  assert.equal(v.status, 'block');
  assert.ok(v.how!.includes('run setup'));
});

test('PC-4 모델 캐시: snapshots 1개 이상 + refs/main 둘 다 필요(자동 내려받기 안내 금지)', () => {
  assert.equal(evalModelCache(1, true, 'h').status, 'pass');
  assert.equal(evalModelCache(0, true, 'h').status, 'block');
  assert.equal(evalModelCache(1, false, 'h').status, 'block');
  assert.ok(evalModelCache(0, false, 'h').how!.includes('§5.8-6'));
});

test('PC-5 브라우저 결과 판정', () => {
  assert.equal(evalBrowserProbe(true, 'msedge', '', '154.0').status, 'pass');
  const f = evalBrowserProbe(false, 'msedge', '기동 실패');
  assert.equal(f.status, 'block');
  assert.ok(f.how!.includes('--browser'));
});

test('PC-6 ffmpeg: 있으면 통과 · 영상을 안 쓰면 정보 · 필요한데 없으면 경고(차단 아님)', () => {
  assert.equal(evalFfmpeg(true, 'd', true).status, 'pass');
  assert.equal(evalFfmpeg(false, 'd', false).status, 'info');
  const w = evalFfmpeg(false, 'C:\\ms-playwright\\ffmpeg-1011', true);
  assert.equal(w.status, 'warn');
  assert.ok(w.message.includes('ffmpeg-1011'));
});

test('PC-7 디스크: 2GB 이상 통과 · 1~2GB 경고 · 1GB 미만 차단 · 모름은 정보', () => {
  assert.equal(evalDisk(5 * GB, 'd').status, 'pass');
  assert.equal(evalDisk(2 * GB, 'd').status, 'pass');
  assert.equal(evalDisk(1.5 * GB, 'd').status, 'warn');
  assert.equal(evalDisk(1 * GB, 'd').status, 'warn');
  assert.equal(evalDisk(0.5 * GB, 'd').status, 'block');
  assert.equal(evalDisk(null, 'd').status, 'info');
});

test('PC-8 포트: 비어 있으면 통과 · 점유 시 PID·이름과 --port-offset 안내로 차단', () => {
  const free = [3000, 5173].map((port, i) => ({ name: (['api', 'console'] as const)[i], port, free: true }));
  assert.equal(evalPorts(free, []).status, 'pass');
  const busy = [{ name: 'api' as const, port: 3000, free: false }, { name: 'console' as const, port: 5173, free: true }, { name: 'stage' as const, port: 5180, free: false }];
  const r = evalPorts(busy, [{ port: 3000, pid: 12840, imageName: 'node.exe' }]);
  assert.equal(r.status, 'block');
  assert.ok(r.message.includes('3000') && r.message.includes('PID 12840') && r.message.includes('node.exe'));
  assert.ok(r.message.includes('5180'));
  assert.ok(r.how!.includes('--port-offset 100'));
});

test('PC-9 외부망: 둘 다 실패=차단됨(통과) · 하나라도 성공=경고 · --require-offline이면 차단', () => {
  const closed = evalNetwork(false, false, false);
  assert.equal(closed.status, 'pass');
  assert.equal(closed.data?.offline, true);
  const open = evalNetwork(true, true, false);
  assert.equal(open.status, 'warn');
  assert.equal(open.data?.offline, false);
  assert.equal(evalNetwork(true, false, false).status, 'warn');
  assert.equal(evalNetwork(false, true, true).status, 'block');
  assert.equal(evalNetwork(false, false, true).status, 'pass');
});

test('PC-10 Ollama: 꺼져 있으면 통과 · 프로세스나 포트가 있으면 경고(끄지는 않는다)', () => {
  assert.equal(evalOllama(false, false).status, 'pass');
  assert.equal(evalOllama(true, true).status, 'warn');
  assert.equal(evalOllama(false, true).status, 'warn');
  assert.ok(evalOllama(true, false).why!.includes('끄지 않습니다'));
});

test('PC-11 메모리: 16GB(십진) 기준 — 16GB 표기 PC(17.0e9 바이트)는 통과, 가용 2GiB 미만은 경고', () => {
  const [total, free] = evalMemory(17_000_000_000, 4 * GB);
  assert.equal(total.status, 'pass');
  assert.equal(free.status, 'info');
  assert.equal(evalMemory(8e9, 4 * GB)[0].status, 'warn');
  assert.equal(evalMemory(17e9, 1 * GB)[1].status, 'warn');
  assert.ok(evalMemory(17e9, 1 * GB)[1].why!.includes('3~10배'));
});

test('PC-12~14 정보 항목', () => {
  assert.equal(evalGpuInfo(['GPU 0: NVIDIA GeForce RTX 3050']).status, 'info');
  assert.ok(evalGpuInfo(null).message.includes('GPU 없음'));
  assert.ok(evalGit('0123456789abcdef', true).message.includes('dirty'));
  assert.ok(evalGit(null, null).message.includes('읽지 못했습니다'));
  assert.ok(evalDevDb({ exists: true, size: 2060288, mtimeMs: 1 }).message.includes('2060288'));
  assert.ok(evalDevDb({ exists: false }).message.includes('없음'));
});

test('PC-15 .env 키 이름만 해석 — 값은 읽지 않는다(= 앞까지)', () => {
  const text = [
    '# 주석',
    '',
    'DATABASE_URL=file:./dev.db',
    'AUGMENTATION_GEMINI_API_KEY = super-secret-value',
    'export FOO=bar',
    'BAD LINE',
    '=novalue',
    '1BAD=x',
    'EMPTY=',
  ].join('\r\n');
  const keys = parseEnvKeyNames(text);
  assert.deepEqual(keys, ['DATABASE_URL', 'AUGMENTATION_GEMINI_API_KEY', 'FOO', 'EMPTY']);
  const item = evalEnvKeys(keys, null);
  assert.ok(!JSON.stringify(item).includes('super-secret-value'));
  assert.ok(item.message.includes('파일 없음'));
});

test('빌드 산출물: 없으면 --no-build일 때만 차단, 아니면 정보', () => {
  assert.equal(evalDistOutputs([], false).status, 'pass');
  assert.equal(evalDistOutputs(['apps/api/dist/main.js'], true).status, 'block');
  assert.equal(evalDistOutputs(['apps/api/dist/main.js'], false).status, 'info');
});

test('HF 캐시·Playwright 브라우저 경로 결정 순서', () => {
  assert.equal(hfHubDir({ HF_HUB_CACHE: 'X:\\hub' }), 'X:\\hub');
  assert.ok(hfHubDir({ HF_HOME: 'X:\\hf' }).replace(/\\/g, '/').endsWith('X:/hf/hub') || hfHubDir({ HF_HOME: 'X:\\hf' }).includes('hub'));
  assert.ok(hfHubDir({ USERPROFILE: 'C:\\Users\\a' }).replace(/\\/g, '/').endsWith('.cache/huggingface/hub'));
  assert.equal(playwrightBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: 'D:\\pw' }), 'D:\\pw');
  assert.ok(playwrightBrowsersPath({ LOCALAPPDATA: 'C:\\L' }).replace(/\\/g, '/').endsWith('C:/L/ms-playwright'));
});
