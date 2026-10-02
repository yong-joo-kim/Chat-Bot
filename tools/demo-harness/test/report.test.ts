// H-T10(result.json 스키마 왕복) · H-T11(보고서 HTML: 외부 URL 0 · lang="ko" · 스크립트 0 · img alt · 표 caption) · 고객 전달판 · 비밀 제거(AC-DH5-3) · GIF 인코딩
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { buildResult, resumeFrom, statusOf, type BuildInput } from '../src/report/build';
import { renderReport, esc } from '../src/report/html';
import { renderSummary } from '../src/report/markdown';
import { parseResult, ResultSchema } from '../src/report/schema';
import { scanRunDirForSecrets, writeGifs, writeReport } from '../src/report/write';
import { decodeAndScale, encodeGif, GifClip, GIF_MAX_FRAMES } from '../src/capture/gif';
import { createRunDir } from '../src/run/run-dir';
import { Redactor } from '../src/util/redact';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';
import type { ScenarioResult, StepResult } from '../src/scenario/runner';

function step(over: Partial<StepResult> & Pick<StepResult, 'id' | 'segment'>): StepResult {
  return { title: '단계', core: true, status: 'PASS', budgetSec: 15, actualSec: 3.2, captures: [], ...over };
}

function scenario(): ScenarioResult {
  const steps: StepResult[] = [
    step({ id: 'S0-01', segment: 'opening', title: '구축형 구성 카드', captures: ['shots/S0-01.png'], narration: { lines: ['이 노트북 한 대를 사내 서버로 가정했습니다'], notice: '문장 분석 대기 시간을 600ms로 늘렸습니다' }, honesty: ['S0-01: 문장 분석 대기 시간을 600ms로 늘렸습니다'] }),
    step({ id: 'S0-02', segment: 'opening', core: false, status: 'SKIPPED', skipReason: 'TIME', title: '데이터 지도' }),
    step({ id: 'S3-02', segment: 's3', title: '대시보드', status: 'FAIL', captures: ['shots/S3-02-FAIL.png'], failure: { kind: 'VERIFY', message: '결과 불일치: 기대 15 / 실제 12', expected: '15', actual: '12' } }),
    step({ id: 'S5-07', segment: 's5', core: false, status: 'FALLBACK', title: '예약 배포', failure: { kind: 'TIMEOUT', message: '라이브 예약 대기' }, honesty: ['S5-07: 예약 기록 화면입니다 - 준비 단계에서 같은 방식으로 실행된 기록입니다'] }),
    step({ id: 'S7-02', segment: 's7', title: '분석 결과', captures: ['shots/S7-02.png', 'gif/S7-02.gif'], honesty: ['S7-02: 미리 같은 파일로 실행해 둔 결과입니다(사내 CPU 약 38초)'], badges: ['CPU 동작'] }),
  ];
  const segments = ['opening', 's3', 's5', 's7'].map((key) => ({ key, title: key, budgetSec: 60, actualSec: 50, steps: steps.filter((s) => s.segment === key) }));
  return { segments, steps, showSec: 301.4, pausedSec: 12, gifClips: [], warnings: ['누적 지연이 25초입니다. 생략 가능 단계를 자동으로 건너뜁니다'] };
}

function input(over: Partial<BuildInput> = {}): BuildInput {
  const segs = customerOnprem10m.segments.filter((s) => ['opening', 's3', 's5', 's7'].includes(s.key));
  return {
    runId: '20261002-143012-a7k2',
    presetId: 'customer-onprem-10m',
    mode: 'visible',
    exitCode: 1,
    startedAt: '2026-10-02T14:30:12+09:00',
    showStartedAt: '2026-10-02T14:36:40+09:00',
    endedAt: '2026-10-02T14:48:00+09:00',
    prepareSec: 380,
    machine: { os: 'Windows_NT 10.0.26200', cpu: 'Intel(R) Core(TM) i7-10750H', cores: 12, ramGb: 15.8, freeRamGb: 8.9, gpu: 'NVIDIA GeForce RTX 3050 Laptop GPU' },
    commit: { sha: 'a'.repeat(40), dirty: true },
    browser: { kind: 'msedge', version: '154.0.4258.37', playwright: '1.63.0', video: true },
    viewport: { width: 1920, height: 1080 },
    latency: { samples: 20, p50Ms: 640.123, p95Ms: 1457.77, decidedTimeoutMs: 600, source: 'measured', rounds: [{ p50Ms: 640.123, p95Ms: 1457.77 }, { p50Ms: 119.9, p95Ms: 167.31 }] },
    overrides: [
      { key: 'EMBEDDING_TIMEOUT_MS', value: '600', defaultValue: '300', reason: '단건 질의 예산(설계 §14)', disclosed: true },
      { key: 'WIDGET_BASE_URL', value: 'http://localhost:5174', defaultValue: '(없음)', reason: '기동 필수', disclosed: true },
      { key: 'DATA_ENCRYPTION_KEYS', value: 'demo1:AAAA', defaultValue: '(없음)', reason: '실행별 키', disclosed: true, secret: true },
    ],
    embeddingUrl: '127.0.0.1:8100',
    blocked: [{ host: 'fonts.googleapis.com', count: 2, firstStepId: 'S0-02' }],
    network: { offline: false, checkedAt: '2026-10-02T14:30:15+09:00' },
    scenario: scenario(),
    segments: segs,
    skipOptionIds: [],
    dataset: { historicalLogs: 420, accounts: 5, chatbots: 3 },
    calibration: [{ id: 'G-1', scene: '장면 1', ok: true, detail: '꺼짐 폴백 / 켜짐 확정' }],
    calibrated: true,
    teardown: { processesLeft: 0, portsFreed: true, devDbUnchanged: true },
    prepare: [{ id: 'P0', name: '사전 점검', sec: 3, status: 'OK' }, { id: 'P2', name: '빌드', sec: 0, status: 'SKIPPED' }, { id: 'P4', name: '데모 데이터', sec: 25.5, status: 'OK' }],
    media: { video: 'video/show.webm', videoReason: null, vtt: 'video/show.vtt', gifs: [] },
    warnings: ['누적 지연이 25초입니다'],
    liveSchedule: { status: 'FAILED', error: '예약 대상 없음' },
    governance: { mode: 'ON', fallback: false, logLine: '데이터 거버넌스 모드=ON · 암호화=꺼짐 · 출구 허용=1개' },
    envKeyNames: { blockedApi: ['AUGMENTATION_GEMINI_API_KEY'], blockedMlWorker: [], removedByPreload: [] },
    customerCopy: true,
    ...over,
  };
}

const FAIL_TAILS = { api: ['[Nest] LOG 시작', '[Nest] ERROR 어떤 오류'], harness: ['하네스 로그 줄'] };

test('종료 코드 → 상태: 0 PASSED · 1 FAILED · 130 ABORTED · 2 PREPARE_FAILED', () => {
  assert.deepEqual([0, 1, 130, 2, 7].map(statusOf), ['PASSED', 'FAILED', 'ABORTED', 'PREPARE_FAILED', 'PREPARE_FAILED']);
});

test('재개 명령의 구간 키: opening→S0 · closing→S9 · s3→S3', () => {
  assert.deepEqual(['opening', 's3', 'closing'].map(resumeFrom), ['S0', 'S3', 'S9']);
});

test('result.json: 스키마 v1 왕복 · 실패 단계에 재개 명령 · 공개표 비밀 가림 · 지연 수치 반올림', () => {
  const r = buildResult(input());
  const back = parseResult(JSON.stringify(r));
  assert.equal(back.schemaVersion, 1);
  assert.equal(back.tool, 'DT-1');
  assert.equal(back.status, 'FAILED');
  const fail = back.steps.find((s) => s.id === 'S3-02')!;
  assert.equal(fail.failure?.resume, 'pnpm demo -- --resume 20261002-143012-a7k2 --from S3');
  assert.equal(fail.failure?.logs?.api, 'logs/api.log');
  assert.equal(back.overrides.find((o) => o.key === 'DATA_ENCRYPTION_KEYS')?.value, '[가림]');
  assert.equal(back.embeddingLatency?.rounds.length, 2);
  assert.equal(back.embeddingLatency?.p95Ms, 1457.8);
  assert.equal(back.machine.gpuUsedByHarness, false);
  assert.ok(ResultSchema.safeParse({ ...back, schemaVersion: 2 }).success === false, '스키마 버전이 다르면 거부');
});

test('result.json: 외부 송신 점검표 8칸(서버 출구 키 · 증강 · 거버넌스 · ml-worker · 개발자 .env · 브라우저 · 네트워크)과 브라우저 차단 기록', () => {
  const r = buildResult(input());
  const cols = new Set(r.egressChecklist.map((c) => c.column));
  for (const c of ['서버 출구 키', '증강 공급자', '거버넌스', 'ml-worker', '개발자 .env', '브라우저', '네트워크']) assert.ok(cols.has(c), c);
  assert.ok(r.egressChecklist.some((c) => c.item === 'ML_WORKER_SPEECH_URL · SPEECH_ENABLED' && c.state === 'UNSET'), 'FR-DX0-2 음성 출구 칸');
  assert.deepEqual(r.browserBlockedRequests, [{ host: 'fonts.googleapis.com', count: 2, firstStepId: 'S0-02' }]);
  assert.equal(r.egressChecklist.find((c) => c.column === '네트워크')?.state, 'OPEN');
});

test('정직성 표기: 종류별 분류(시연용 설정 · 미리 준비한 결과 · 대체 · 건너뜀 · 과거 데이터)와 준비 단계 보정', () => {
  const r = buildResult(input());
  const kinds = (k: string) => r.honesty.filter((h) => h.kind === k).map((h) => h.stepId ?? '-');
  assert.ok(kinds('DEMO_SETTING').includes('S0-01'));
  assert.ok(kinds('PREPARED_RESULT').includes('S7-02'));
  assert.deepEqual(kinds('FALLBACK'), ['S5-07']);
  assert.deepEqual(kinds('SKIPPED'), ['S0-02']);
  assert.ok(r.honesty.some((h) => h.kind === 'HISTORICAL_DATA' && h.text.includes('420건')));
  assert.ok(r.honesty.some((h) => h.text.includes('준비 단계 보정')));
  assert.ok(!r.honesty.some((h) => h.kind === 'MOCK'), '모형 서버 0');
});

test('구간 상태: 실패가 있으면 FAILED · 전부 생략이면 SKIPPED · 실행 안 한 구간은 NOT_RUN', () => {
  const r = buildResult(input({ segments: customerOnprem10m.segments.filter((s) => ['opening', 's3', 's5', 's6'].includes(s.key)) }));
  const by = Object.fromEntries(r.segments.map((s) => [s.key, s.status]));
  assert.equal(by.s3, 'FAILED');
  assert.equal(by.s6, 'NOT_RUN');
  assert.equal(by.opening, 'PASSED');
});

// ── HTML ──
test('내부판 HTML(H-T11): doctype · lang="ko" · 외부 URL 0 · 스크립트 0 · 제목 1개 · skip 링크 · 앵커 목차', () => {
  const html = renderReport(buildResult(input()), { customer: false, logTails: FAIL_TAILS });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="ko">/);
  assert.ok(!html.includes('://'), '문서 안에 :// 가 남아 있다');
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<link\s/i.test(html), '외부 CSS 링크 0');
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.ok(html.includes('href="#main"') && html.includes('id="main"'));
  assert.ok(html.includes('<nav aria-label="보고서 목차">'));
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(/@page\s*\{\s*size:A4/.test(html));
  assert.ok(html.includes(':has(#theme-dark:checked)'));
});

test('HTML: 모든 이미지에 alt · 모든 표에 caption + th scope · 영상은 자막 트랙(default 없음)', () => {
  const html = renderReport(buildResult(input()), { customer: false, logTails: FAIL_TAILS });
  for (const m of html.matchAll(/<img\b[^>]*>/g)) assert.ok(/\balt="[^"]+"/.test(m[0]), m[0]);
  const tables = (html.match(/<table>/g) ?? []).length;
  assert.ok(tables >= 6);
  assert.equal((html.match(/<caption>/g) ?? []).length, tables);
  assert.ok(!/<th>/.test(html), '모든 th에 scope');
  assert.match(html, /<video controls[^>]*src="\.\.\/video\/show\.webm"><track kind="captions" srclang="ko"/);
  assert.ok(!/<track[^>]*\bdefault\b/.test(html), '번인 자막과 겹치지 않게 default 없음');
});

test('HTML: 실패가 있으면 실패 요약이 결과 요약 바로 아래 · 실패 카드 4요소 · 재개 명령 · 로그 details open · 구간 단위 재개 안내', () => {
  const html = renderReport(buildResult(input()), { customer: false, logTails: FAIL_TAILS });
  assert.ok(html.indexOf('id="s-summary"') < html.indexOf('id="s-fail"') && html.indexOf('id="s-fail"') < html.indexOf('id="s-gallery"'));
  for (const label of ['무엇이 실패했나', '기대값 / 실제값', '왜 그럴 수 있나', '어떻게 하나']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('pnpm demo -- --resume 20261002-143012-a7k2 --from S3'));
  assert.ok(html.includes('구간 단위'));
  assert.ok(html.includes('<details open>'));
  assert.ok(html.includes('id="fail-S3-02"'));
  assert.ok(html.includes('[Nest] ERROR 어떤 오류'));
});

test('HTML: 단건 지연은 라운드 표 + "결정에 쓴 라운드"(정정 #4) · 시연용 설정 공개표 · 로드맵 6행(No.32는 구현됨)', () => {
  const html = renderReport(buildResult(input()), { customer: false });
  assert.ok(html.includes('단건 지연 측정 라운드'));
  assert.ok(html.includes('결정에 쓴 라운드'));
  assert.ok(html.includes('EMBEDDING_TIMEOUT_MS'));
  assert.ok(html.includes('[가림]'));
  const road = html.slice(html.indexOf('id="s-roadmap"'));
  for (const no of [32, 33, 31, 34, 17, 38]) assert.ok(road.includes(`No.${no}`), `No.${no}`);
  assert.ok(road.includes('구현됨 · 확장판에서 시연 예정'));
});

test('HTML: 정직성 절은 항상 보이고(해당 없음 포함) 개선 후보에 DHX-1이 관측된다', () => {
  const html = renderReport(buildResult(input()), { customer: false });
  assert.ok(html.includes('id="s-honesty"'));
  assert.ok(html.includes('시연용 과거 대화 기록 420건'));
  assert.ok(html.includes('DHX-1'));
  const clean = renderReport(buildResult(input({ blocked: [], calibrated: false, dataset: null })), { customer: false });
  assert.ok(clean.includes('모형 서버를 쓰지 않았습니다'));
  assert.ok(clean.includes('이번 실행에서 관측된 개선 후보가 없습니다') || clean.includes('DHX-1') === false);
});

test('고객 전달판: 실패 상세·로그·재개 명령·종료 코드·개선 후보 제거, 실패 단계는 "이번 시연에서 생략된 장면", 정직성·점검표·공개표는 유지', () => {
  const html = renderReport(buildResult(input()), { customer: true, logTails: FAIL_TAILS });
  assert.ok(html.includes('이번 시연에서 생략된 장면'));
  for (const gone of ['id="fail-S3-02"', '[Nest] ERROR', 'pnpm demo -- --resume', '종료 코드', '개선 후보', '왜 그럴 수 있나']) assert.ok(!html.includes(gone), gone);
  for (const kept of ['id="s-honesty"', 'id="s-egress"', 'id="s-settings"', 'id="s-roadmap"']) assert.ok(html.includes(kept), kept);
  assert.ok(!html.includes('://'));
  assert.ok(!/admin\d@demo\.local|@demo\.local/.test(html), '계정 이메일 제거');
});

test('준비 실패 보고서: 재개 대신 새 실행 안내 · 실패한 준비 단계', () => {
  const r = buildResult(input({ exitCode: 2, scenario: null, segments: [], prepareFailure: { phase: 'P3 서버 기동', message: 'API 기동 실패', why: '자식 프로세스가 종료했습니다', how: '로그를 확인하세요' } }));
  const html = renderReport(r, { customer: false });
  assert.ok(html.includes('준비 실패 - 시연하지 못함'));
  assert.ok(html.includes('P3 서버 기동') && html.includes('새 실행으로 다시 시작하세요'));
  assert.ok(!html.includes('--resume'));
});

test('이스케이프: HTML 특수문자와 URL 구분자', () => {
  assert.equal(esc('<b>"a"&\'</b>'), '&lt;b&gt;&quot;a&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(esc('http://x'), 'http&#58;//x');
  const r = buildResult(input({ overrides: [{ key: 'X', value: '<script>alert(1)</script>', defaultValue: '', reason: 'r', disclosed: true }] }));
  assert.ok(!renderReport(r, { customer: false }).includes('<script>'));
});

test('summary.md: 결과 · 실패 · 재개 명령 · 정직성 · 점검표', () => {
  const md = renderSummary(buildResult(input()));
  for (const s of ['# 시연 결과 요약', '일부 실패', 'S3-02', 'pnpm demo -- --resume', '## 정직성 표기', '## 외부 송신 점검표', 'fonts.googleapis.com']) assert.ok(md.includes(s), s);
});

// ── 파일 쓰기 · 비밀 제거(AC-DH5-3) ──
test('보고서 쓰기: 4개 파일 · 비밀(비밀번호·쿠키 값)은 어느 파일에도 남지 않고 자기 검사가 0건', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbdemo-report-'));
  try {
    const run = createRunDir(root);
    const red = new Redactor();
    red.register('Sup3r-Secret-Pw!');
    red.register('cookie-value-ABCDEF');
    const r = buildResult(input({ scenario: { ...scenario(), steps: scenario().steps.map((s) => (s.id === 'S3-02' ? { ...s, failure: { kind: 'VERIFY' as const, message: '로그인 Sup3r-Secret-Pw! 실패 cb_session=cookie-value-ABCDEF' } } : s)) } }));
    const out = writeReport({ run, result: r, gifClips: [], redact: (t) => red.redact(t), logTails: { api: ['password":"Sup3r-Secret-Pw!"'] }, customerCopy: true });
    assert.deepEqual(out.files.sort(), ['report/customer.html', 'report/index.html', 'report/result.json', 'report/summary.md']);
    for (const f of out.files) {
      const text = readFileSync(join(run.dir, f), 'utf8');
      assert.ok(!text.includes('Sup3r-Secret-Pw!') && !text.includes('cookie-value-ABCDEF'), f);
    }
    assert.ok(readFileSync(join(run.report, 'index.html'), 'utf8').includes('[가림]'));
    assert.deepEqual(scanRunDirForSecrets(run.dir, red), []);
    // 일부러 비밀을 흘린 텍스트 파일은 자기 검사가 잡는다
    writeFileSync(join(run.logs, 'leak.log'), 'oops Sup3r-Secret-Pw!', 'utf8');
    assert.deepEqual(scanRunDirForSecrets(run.dir, red), ['logs/leak.log']);
    // 쓴 result.json은 스키마를 통과한다
    parseResult(readFileSync(join(run.report, 'result.json'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('고객 전달판은 옵션일 때만 만든다', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbdemo-report-'));
  try {
    const run = createRunDir(root);
    const out = writeReport({ run, result: buildResult(input({ customerCopy: false })), gifClips: [], redact: (t) => t, customerCopy: false });
    assert.ok(!out.files.includes('report/customer.html'));
    assert.ok(!existsSync(join(run.report, 'customer.html')));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

// ── GIF ──
function pngFrame(w: number, h: number, shade: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = (shade + (i % w)) % 256;
    png.data[i * 4 + 1] = (shade * 2 + Math.floor(i / w)) % 256;
    png.data[i * 4 + 2] = shade;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('GIF: 가로 960으로 줄이고(비율 유지) GIF89a 헤더와 프레임 수만큼의 이미지를 낸다', () => {
  const scaled = decodeAndScale(pngFrame(1920, 1080, 10), 960);
  assert.deepEqual([scaled.width, scaled.height], [960, 540]);
  const gif = encodeGif([pngFrame(1920, 1080, 10), pngFrame(1920, 1080, 90)])!;
  assert.equal(gif.subarray(0, 6).toString('latin1'), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 960);
  assert.equal(gif.readUInt16LE(8), 540);
  assert.equal(gif[gif.length - 1], 0x3b, 'GIF 종결자');
  assert.equal(encodeGif([]), null);
});

test('GIF 파일 쓰기: gif/<단계 ID>.gif · 프레임 없는 클립은 건너뛴다', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbdemo-gif-'));
  try {
    const run = createRunDir(root);
    const r = writeGifs(run, [
      { stepId: 'S1-05', frames: [pngFrame(320, 180, 5), pngFrame(320, 180, 50)] },
      { stepId: 'S2-06', frames: [] },
    ]);
    assert.deepEqual(r.gifs, ['gif/S1-05.gif']);
    assert.deepEqual(readdirSync(run.gif), ['S1-05.gif']);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('GifClip: 수집 루프는 최대 12장(마지막 1장 포함)에서 멈추고, 캡처 실패는 건너뛴다', async () => {
  let n = 0;
  const clip = new GifClip('S1-05', async () => {
    n++;
    if (n === 2) throw new Error('이동 중');
    return Buffer.from([n]);
  });
  await new Promise((r) => setTimeout(r, 1300));
  await clip.stop();
  assert.ok(clip.frames.length >= 2 && clip.frames.length <= GIF_MAX_FRAMES);
  assert.ok(!clip.frames.some((f) => f[0] === 2), '실패한 장은 담지 않는다');
});
