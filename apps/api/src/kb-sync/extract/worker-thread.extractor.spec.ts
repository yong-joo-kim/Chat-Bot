import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { HTML_JOB_TIMEOUT_MS, WORKER_RESOURCE_LIMITS, WorkerThreadExtractor } from './worker-thread.extractor';

/**
 * [신규 No.43 — 항목②] `WorkerThreadExtractor`의 운영 방어선(192MB 힙 상한 · 시간 상한 초과 시
 * 강제 종료)이 실제로 동작하는지 검증한다.
 *
 * ts-jest 환경에서는 `__dirname`이 소스 트리(`src/...`)라 컴파일된 `extract.worker.js`가 옆에 없다
 * — 그래서 이 파일의 `beforeAll`이 **실제 빌드**(`tsc -p tsconfig.json`)를 한 번 돌려
 * `dist/kb-sync/extract/extract.worker.js`를 만든다(운영과 동일한 산출물). `worker-thread.extractor.ts`
 * 의 `src`→`dist` 치환 경로 해석이 이 산출물을 찾아 쓴다.
 *
 * 192MB 힙 폭주·무한루프 같은 "일부러 고장 내는" 시나리오는 실제 `extract.worker.js`(정상 파서)로는
 * 재현하기 어렵다(정상 입력은 방어적으로 설계돼 있다) — 그래서 이 두 시나리오만 산출물 파일 내용을
 * 임시로 통제된 스크립트로 바꿔치기해 검증하고, 시험이 끝나면 원본으로 되돌린다. `WorkerThreadExtractor`
 * 자체의 코드(해석·타임아웃·종료 로직)는 전혀 건드리지 않는다 — 오직 "그 로직이 실행할 스크립트
 * 파일의 내용"만 바꾼다.
 */
const API_ROOT = join(__dirname, '..', '..', '..');
const DIST_WORKER_PATH = join(API_ROOT, 'dist', 'kb-sync', 'extract', 'extract.worker.js');

function buildDistArtifact(): void {
  execSync('npx tsc -p tsconfig.json', { cwd: API_ROOT, stdio: 'pipe' });
  if (!existsSync(DIST_WORKER_PATH)) throw new Error(`빌드 후에도 산출물이 없습니다: ${DIST_WORKER_PATH}`);
}

describe('WorkerThreadExtractor — 항목② 192MB/30초(HTML 5초) 방어선 실측', () => {
  let originalDistSource: string;

  beforeAll(() => {
    buildDistArtifact();
    originalDistSource = readFileSync(DIST_WORKER_PATH, 'utf8');
  }, 60_000);

  afterEach(() => {
    // 각 시험이 산출물 내용을 바꿨다면 원복한다(다음 시험·다른 spec 파일에 영향 없도록).
    writeFileSync(DIST_WORKER_PATH, originalDistSource, 'utf8');
  });

  it('설정값 자체가 설계서와 일치한다(힙 192MB · HTML 5초 — §7.2)', () => {
    expect(WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb).toBe(192);
    expect(HTML_JOB_TIMEOUT_MS).toBe(5_000);
  });

  it('★ src→dist 치환 경로 해석이 방금 만든 빌드 산출물을 실제로 찾아 정상 추출까지 완주한다', async () => {
    const extractor = new WorkerThreadExtractor();
    try {
      const result = await extractor.extract({ kind: 'HTML', html: '<html><body><main><h1>제목</h1><p>본문입니다.</p></main></body></html>', noisePatterns: [], piiMask: false, piiMaskMode: 'PARTIAL' });
      expect(result.ok).toBe(true);
      expect(result.text).toContain('본문');
    } finally {
      await extractor.onModuleDestroy();
    }
  }, 15_000);

  it('★ [pass 4 위반 8] 사이트맵은 작업 스레드가 gzip 해제·파싱한다(ArrayBuffer 이전 포함) — 해제 50MB 상한 위반은 예외 없이 REJECTED', async () => {
    const extractor = new WorkerThreadExtractor();
    try {
      const xml = '<?xml version="1.0"?><urlset><url><loc>https://a.example/docs/1</loc></url><url><loc>https://a.example/docs/2</loc></url></urlset>';
      const ok = await extractor.extract({ kind: 'SITEMAP', bytes: new Uint8Array(gzipSync(Buffer.from(xml))), contentType: 'application/gzip', gzipped: true });
      expect(ok.ok).toBe(true);
      expect(ok.sitemap).toEqual({ kind: 'URLSET', locs: ['https://a.example/docs/1', 'https://a.example/docs/2'] });

      const bomb = await extractor.extract({ kind: 'SITEMAP', bytes: new Uint8Array(gzipSync(Buffer.alloc(51 * 1024 * 1024, 0))), contentType: null, gzipped: true });
      expect(bomb.ok).toBe(false);
      expect(bomb.sitemap?.kind).toBe('REJECTED');

      // 폭탄 뒤에도 같은 작업 스레드가 정상 응답한다(스레드도 프로세스도 죽지 않았다).
      const after = await extractor.extract({ kind: 'SITEMAP', bytes: new Uint8Array(Buffer.from(xml)), contentType: null, gzipped: false });
      expect(after.sitemap?.locs).toHaveLength(2);
    } finally {
      await extractor.onModuleDestroy();
    }
  }, 30_000);

  it('★ 192MB 힙 상한을 실제로 넘기면(V8 OOM) 작업 스레드가 죽고, 시간 상한을 기다리지 않고 곧바로 실패로 수렴한다', async () => {
    // 산출물을 "메시지를 받으면 즉시 192MB를 훌쩍 넘는 배열을 계속 채우는" 스크립트로 바꿔치기한다.
    const oomScript = [
      "const { parentPort } = require('node:worker_threads');",
      'parentPort.on("message", () => {',
      '  const chunks = [];',
      '  // 192MB(maxOldGenerationSizeMb) 상한을 확실히 넘도록 총 400MB 이상을 계속 쌓는다.',
      '  for (let i = 0; i < 500; i += 1) chunks.push(new Array(1024 * 1024).fill(String(Math.random())));',
      '});',
    ].join('\n');
    writeFileSync(DIST_WORKER_PATH, oomScript, 'utf8');

    const extractor = new WorkerThreadExtractor();
    const startedAt = Date.now();
    try {
      await expect(extractor.extract({ kind: 'HTML', html: '<html></html>', noisePatterns: [], piiMask: false, piiMaskMode: 'PARTIAL' })).rejects.toThrow(/WORKER_CRASHED/);
      const elapsedMs = Date.now() - startedAt;
      // 시간 상한(HTML 5초)을 기다리지 않고 OOM 즉시 실패했는지 확인 — 상한의 절반보다 한참 빠르다.
      expect(elapsedMs).toBeLessThan(HTML_JOB_TIMEOUT_MS / 2);
    } finally {
      await extractor.onModuleDestroy();
    }
  }, 15_000);

  it('★ 작업이 시간 상한(HTML 5초)을 넘기면 작업 스레드를 강제 종료하고 FILE_UNSAFE_TIMEOUT으로 실패한다', async () => {
    // 산출물을 "메시지를 받으면 응답 없이 무한 루프(동기·비협조적)"로 바꿔치기한다 — `worker.terminate()`
    // 는 V8 isolate 레벨 강제 종료라 협조적 종료(메시지 처리)에 의존하지 않는다.
    const hangScript = ["const { parentPort } = require('node:worker_threads');", 'parentPort.on("message", () => { while (true) { /* 응답 없이 계속 돈다 */ } });'].join('\n');
    writeFileSync(DIST_WORKER_PATH, hangScript, 'utf8');

    const extractor = new WorkerThreadExtractor();
    const startedAt = Date.now();
    try {
      await expect(extractor.extract({ kind: 'HTML', html: '<html></html>', noisePatterns: [], piiMask: false, piiMaskMode: 'PARTIAL' })).rejects.toThrow(/FILE_UNSAFE_TIMEOUT/);
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(HTML_JOB_TIMEOUT_MS - 200); // 상한 이전에 끝나지 않았다(진짜로 기다렸다가 종료했다).

      // 강제 종료가 실제로 일어났는지 — 죽은 워커를 재사용하지 않고 "새로 만든 워커가 정상 스크립트로
      // 응답"하는지로 간접 확인한다(원복 후 재요청).
      writeFileSync(DIST_WORKER_PATH, originalDistSource, 'utf8');
      const followUp = await extractor.extract({ kind: 'HTML', html: '<html><body><main>정상 복구 확인용 본문입니다.</main></body></html>', noisePatterns: [], piiMask: false, piiMaskMode: 'PARTIAL' });
      expect(followUp.ok).toBe(true);
    } finally {
      await extractor.onModuleDestroy();
    }
  }, 15_000);
});

/** `sep` 사용 — 린트가 미사용 import로 걸지 않도록 최소 검증도 겸한다(경로 해석이 OS 구분자 기준임을 확인). */
it('sanity: __dirname은 src 트리다(ts-jest 실행 확인 — 이 시험 세트의 전제)', () => {
  expect(__dirname.split(sep)).toContain('src');
});
