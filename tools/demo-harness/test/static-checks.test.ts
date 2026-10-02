// 정적 검사(설계 §20.2 · §3.2 · §3.4 · §19): 제품 소스 비의존 · 고정 지연 금지 · shell:true 1곳 · 루트 명령 비영향 · 의존성 고정.
// 소스는 컴파일 전 `src/**/*.ts` 를 읽는다(dist/test 에서 실행되므로 패키지 루트로 올라간다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const PKG_ROOT = join(__dirname, '..', '..');
const SRC = join(PKG_ROOT, 'src');
const REPO = join(PKG_ROOT, '..', '..');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(PKG_ROOT, p).split(sep).join('/');
const TS_FILES = walk(SRC, ['.ts']);
const read = (p: string) => readFileSync(p, 'utf8');

test('소스 트리 존재(정적 검사의 전제)', () => {
  assert.ok(existsSync(SRC), SRC);
  assert.ok(TS_FILES.length > 20);
});

test('H-S1: 하네스 소스는 apps/*/src · packages/*/src 를 import하지 않는다', () => {
  const bad: string[] = [];
  for (const f of TS_FILES) {
    for (const m of read(f).matchAll(/(?:from\s+|require\(|import\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|[\\/])(apps|packages)[\\/][^'"]*[\\/]src([\\/]|$)/.test(spec)) bad.push(`${rel(f)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('H-S1: 제품 패키지는 @chat-bot/shared-types 진입점만 import(다른 워크스페이스 패키지·dist 직접 import 금지)', () => {
  const allowed = new Set(['@chat-bot/shared-types']);
  const bad: string[] = [];
  for (const f of TS_FILES) {
    for (const m of read(f).matchAll(/from\s+['"](@chat-bot\/[^'"]+)['"]/g)) if (!allowed.has(m[1])) bad.push(`${rel(f)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('H-S2: setTimeout/sleep 호출은 util/wait-for.ts 와 scenario/pacing.ts 에만(조건 대기 규약 — pacing의 holdForMedia 포함)', () => {
  const allowed = new Set(['src/util/wait-for.ts', 'src/scenario/pacing.ts']);
  const bad: string[] = [];
  for (const f of TS_FILES) {
    if (allowed.has(rel(f))) continue;
    const text = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/(?<![.\w])setTimeout\s*\(/.test(text) || /(?<![.\w])sleep\s*\(/.test(text) || /\bnew Promise\([^)]*setTimeout/.test(text)) bad.push(rel(f));
  }
  assert.deepEqual(bad, []);
});

test('H-S4: spawn/exec 호출의 shell:true 는 proc/pnpm.ts 폴백 1곳뿐', () => {
  const holders = TS_FILES.filter((f) => /shell\s*:\s*(true|plan\.shell|[a-z]+\.shell)/.test(read(f).replace(/\/\/.*$/gm, ''))).map(rel);
  assert.deepEqual(holders, ['src/proc/pnpm.ts']);
  for (const f of TS_FILES) {
    const text = read(f).replace(/\/\/.*$/gm, '');
    assert.ok(!/shell\s*:\s*true/.test(text) || rel(f) === 'src/proc/pnpm.ts', rel(f));
    // child_process.exec/execSync(셸 경유)는 쓰지 않는다 — spawn/spawnSync/execFile 계열만
    assert.ok(!/(?<![\w.])exec(Sync)?\s*\(/.test(text), `${rel(f)}: 셸을 거치는 exec 사용 금지`);
  }
});

test('DB 직접 쓰기·제품 DB 접근 금지: 1단계 소스는 @prisma/client·dev.db 를 열지 않는다(읽기 지문 제외)', () => {
  for (const f of TS_FILES) {
    const text = read(f);
    assert.ok(!/from\s+['"]@prisma\/client['"]/.test(text), `${rel(f)}: PrismaClient import 금지(1단계)`);
  }
});

test('패키지: private · 스크립트 이름이 루트 재귀 명령(build·test·dev·lint·typecheck)에 걸리지 않는다', () => {
  const pkg = JSON.parse(read(join(PKG_ROOT, 'package.json'))) as { name: string; private: boolean; scripts: Record<string, string> };
  assert.equal(pkg.name, '@chat-bot/demo-harness');
  assert.equal(pkg.private, true);
  for (const banned of ['build', 'test', 'dev', 'lint', 'typecheck', 'start']) assert.equal(pkg.scripts[banned], undefined, banned);
  assert.ok(pkg.scripts.demo && pkg.scripts['harness:build'] && pkg.scripts['harness:test'] && pkg.scripts['harness:typecheck']);
});

test('루트 package.json: build·test·dev·lint 불변 + demo·demo:check 추가', () => {
  const root = JSON.parse(read(join(REPO, 'package.json'))) as { scripts: Record<string, string> };
  assert.equal(root.scripts.build, 'pnpm -r build');
  assert.equal(root.scripts.test, 'pnpm -r test');
  assert.equal(root.scripts.dev, 'pnpm --parallel -r --filter=./apps/* dev');
  assert.equal(root.scripts.lint, 'eslint .');
  assert.equal(root.scripts.demo, 'pnpm -C tools/demo-harness run demo --');
  assert.equal(root.scripts['demo:check'], 'pnpm -C tools/demo-harness run demo -- --mode headless-check');
});

test('의존성: playwright-core 정확 버전 고정 · 설치 스크립트 있는 의존성 0 · allowBuilds 불변', () => {
  const pkg = JSON.parse(read(join(PKG_ROOT, 'package.json'))) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.match(pkg.dependencies['playwright-core'], /^\d+\.\d+\.\d+$/, '^/~ 금지(정확 버전)');
  assert.match(pkg.dependencies.pngjs, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.dependencies.gifenc, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.dependencies['@chat-bot/shared-types'], 'workspace:*');
  for (const name of ['playwright-core', 'pngjs', 'gifenc']) {
    const manifest = JSON.parse(read(join(PKG_ROOT, 'node_modules', name, 'package.json'))) as { scripts?: Record<string, string> };
    for (const hook of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[hook], undefined, `${name}.${hook}`);
  }
  const ws = read(join(REPO, 'pnpm-workspace.yaml'));
  const allow = ws.slice(ws.indexOf('allowBuilds:'));
  for (const name of ['playwright', 'pngjs', 'gifenc']) assert.ok(!allow.includes(name), `allowBuilds에 ${name} 추가 금지`);
  assert.ok(ws.includes('"tools/*"'));
  assert.deepEqual(
    allow.split(/\r?\n/).filter((l) => /^\s+'?[@\w/.-]+'?:\s*(true|false)/.test(l)).map((l) => l.trim()),
    ["'@nestjs/core': true", "'@prisma/client': true", "'@prisma/engines': true", 'canvas: false', 'esbuild: true', 'prisma: true'],
  );
});

test('.gitignore: 실행 폴더 무시', () => {
  assert.ok(/^\/\.demo-runs\/\s*$/m.test(read(join(REPO, '.gitignore'))));
});

test('API 선적재 스크립트는 src/runtime 에 있고 dist로 복사되지 않아도 경로가 맞는다', () => {
  assert.ok(existsSync(join(SRC, 'runtime', 'isolate-api-env.cjs')));
  assert.ok(existsSync(join(dirname(SRC), 'assets', 'stage.html')));
});

test('사용법 문서(NFR-DHM3): 시연 전 확인(Ollama 종료·메모리)·ffmpeg 반입 폴더·--stop·남은 수동 확인(M-1·M-2)·종료 코드를 담는다', () => {
  const doc = read(join(REPO, 'docs', '05-ops', '시연_하네스.md'));
  for (const must of ['Ollama', 'ffmpeg-1011', 'winldd-1007', '--stop', 'M-1', 'M-2', 'pnpm demo:check', '종료 코드', 'result.json', '엔터', 'NODE_PATH']) assert.ok(doc.includes(must), must);
});

test('assets/*.html·css·js 에는 외부 URL이 없다(H-T11 — 폐쇄망 · 모형 페이지의 위젯 스니펫은 실행 중 서버가 채운다)', () => {
  const dir = join(PKG_ROOT, 'assets');
  for (const name of readdirSync(dir)) assert.ok(!read(join(dir, name)).includes('://'), name);
});

test('3단계 새 소스는 apps/*/src·packages/*/src 를 import하지 않고 shell:true 를 쓰지 않는다', () => {
  for (const f of TS_FILES.filter((x) => /src\/(report|capture|control|orchestrator|scenarios)\//.test(rel(x)))) {
    const text = read(f);
    assert.ok(!/(?:from\s+|require\()\s*['"][^'"]*(?:apps|packages)[\/][^'"]*[\/]src/.test(text), rel(f));
    assert.ok(!/shell\s*:\s*true/.test(text), rel(f));
  }
});
