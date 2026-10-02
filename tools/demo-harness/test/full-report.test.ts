// H-T27(풀 투어 로드맵 · 서버) · H-T28(result.json 키 집합 · 풀 투어 왕복 · 고객판) · H-T29(배지 증거 · 사실 칩) · H-T30(선제 스니펫 변환) · 계획 요약 — DT-2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { SCAN_HEAD_BYTES } from '../src/orchestrator/full-report';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROADMAP } from '../src/data/roadmap';
import { withProactiveAttr } from '../src/data/generator-full';
import { buildResult, type BuildInput, type FullReportInput } from '../src/report/build';
import { renderReport } from '../src/report/html';
import { renderSummary } from '../src/report/markdown';
import { parseResult } from '../src/report/schema';
import { badgeEvidence, composeChips, FACT_CHIP_LABELS, MAX_CHIPS_FULL, resolveBadges } from '../src/scenario/badges';
import { buildRoadmapRows } from '../src/stage/roadmap-html';
import { buildRoadmapFullValues, isSafeSnippet, startStageServer } from '../src/servers/stage-server';
import { repoPaths } from '../src/config';
import { defaultPlan, omittedCustomerLines, resolvePreset } from '../src/scenario/plan';
import { customerOnpremFull } from '../src/presets/customer-onprem-full';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';
import { mergeInactiveRows, scanAudioTraces } from '../src/orchestrator/full-report';
import { buildStagePlan, createFullRuntime, emptyRecord, refreshResolved } from '../src/orchestrator/full-prepare';
import { DEFAULT_OPTIONS } from '../src/cli/args';
import type { RunFacts, StepDef } from '../src/scenario/types';
import type { ScenarioResult, StepResult } from '../src/scenario/runner';

const FACTS: RunFacts = { device: 'cpu', gpuHidden: true, governance: 'ON', externalAddresses: 0, embeddingTimeoutMs: 300, embeddingTimeoutDefault: 300, governanceFallback: false };

// ── H-T29 ──
test('H-T29: gpuActive가 비면 "CPU 동작" 배지는 DT-1과 같다 · 음성 cuda 상주·Ollama 적재 중이면 표시하지 않는다', () => {
  assert.equal(badgeEvidence('CPU_ONLY', FACTS, false), true);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, gpuActive: [] }, false), true);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, gpuActive: ['음성 인식(GPU)'] }, false), false);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, gpuActive: ['사내 생성 모델'] }, false), false);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, device: 'cuda' }, false), false);
  assert.deepEqual(resolveBadges(['ONPREM_INSTALL', 'CPU_ONLY'], FACTS, false), ['사내 설치', 'CPU 동작']);
});

test('H-T29: 사실 칩 — 10분판(full=false)은 칩 합계 2 · 사실 칩 없음 / 풀 투어는 합계 3 · 사실 칩 우선 · CPU 배지 자리를 GPU 사용 칩이 대신한다', () => {
  const step = { badges: ['ONPREM_INSTALL', 'CPU_ONLY', 'NO_EXTERNAL_SEND'] as StepDef['badges'], facts: undefined };
  const a = composeChips(step, FACTS, true, false);
  assert.deepEqual([a.facts, a.badges], [[], ['사내 설치', 'CPU 동작']]);
  assert.equal(MAX_CHIPS_FULL, 3);
  const live = { ...FACTS, gpuActive: ['음성 인식(GPU)'] };
  const b = composeChips({ badges: ['CPU_ONLY'], facts: undefined }, live, true, true);
  assert.deepEqual([b.facts, b.badges], [['GPU 사용'], []]);
  assert.equal(b.hidden.length, 1);
  assert.ok(b.hidden[0].why.includes('음성 인식(GPU)'));
  // 사실 칩 3종 + 강조 배지: 합계 3 — 사실 칩이 우선
  const c = composeChips({ badges: ['HUMAN_APPROVAL'], facts: ['GPU_USED', 'CHECKED_ONLY'] }, live, true, true);
  assert.deepEqual([c.facts, c.badges], [['GPU 사용', '동작 확인'], ['사람 승인']]);
  const d = composeChips({ badges: ['ONPREM_INSTALL', 'NO_EXTERNAL_SEND'], facts: ['SYNTHETIC_VOICE', 'GPU_USED'] }, live, true, true);
  assert.deepEqual([d.facts, d.badges], [['합성 음성', 'GPU 사용'], ['사내 설치']]);
  assert.ok(d.hidden.some((h) => h.badge === '외부 송신 없음'), '밀려난 배지는 표시 내역에 이유와 함께 남는다');
  // GPU를 안 쓰면 GPU 사용 칩은 나오지 않는다
  assert.deepEqual(composeChips({ badges: [], facts: ['GPU_USED', 'CHECKED_ONLY'] }, FACTS, true, true).facts, ['동작 확인']);
  assert.deepEqual(Object.values(FACT_CHIP_LABELS), ['GPU 사용', '합성 음성', '동작 확인']);
});

// ── H-T30 ──
test('H-T30: 선제 스니펫 변환 — 콘솔(ProactiveSection)과 같은 결과 · 이미 있으면 그대로 · 변환 뒤에도 isSafeSnippet 통과', () => {
  const s = '<script src="http://localhost:5174/widget.js" data-chatbot="gaon-order" async></script>';
  const out = withProactiveAttr(s);
  assert.equal(out, s.replace('></script>', ' data-proactive="on"></script>'));
  assert.ok(out.endsWith(' data-proactive="on"></script>'));
  assert.equal(withProactiveAttr(out), out);
  assert.equal(isSafeSnippet(out), true);
  assert.equal(isSafeSnippet(`${out}<script>alert(1)</script>`), false);
});

// ── 로드맵(H-T27) ──
test('H-T27: 풀 투어 로드맵 — 오늘 시연한 기능(No.32)을 뺀 행 · 활성 장면 목록(9~10) · 생략 줄 · 값은 이스케이프', () => {
  assert.ok(buildRoadmapRows().includes('No.32'));
  assert.ok(!buildRoadmapRows([32]).includes('No.32'));
  assert.equal((buildRoadmapRows([32]).match(/<li>/g) ?? []).length, ROADMAP.length - 1);
  const v = buildRoadmapFullValues({ scenes: ['s1', 's2', 'voice', 'proactive'], omitted: ['x <b>y</b>'], excludeNos: [32] });
  assert.equal(v.DONE_TITLE, '시연 완료 · 오늘 보여 드린 4가지');
  assert.equal((v.DONE_ITEMS.match(/<li>/g) ?? []).length, 4);
  assert.ok(v.OMIT_LINES.includes('&lt;b&gt;'));
  assert.equal(v.DONE_CLASS, '');
  assert.equal(buildRoadmapFullValues({ scenes: Array.from({ length: 10 }, () => 's1'), omitted: [], excludeNos: [] }).DONE_CLASS, 'many');
  assert.ok(buildRoadmapFullValues({ scenes: [], omitted: [], excludeNos: [] }).OMIT_LINES.includes('생략한 장면은 없습니다'));
});

test('H-T27: 고객용 생략 줄에는 옵션 이름·포트가 없다 · hidden(S4-03·실시간 분석)은 올리지 않는다 · 같은 장면은 한 줄', () => {
  const r = resolvePreset(customerOnpremFull, { ...defaultPlan('customer-onprem-full', 'visible'), full: true, localLlm: false, llmRequested: true, llmOmittedReason: 'Ollama --x' });
  const lines = omittedCustomerLines(r.inactiveRows.filter((x) => !x.reason.hidden), r.inactiveSegments.filter((x) => !x.reason.hidden));
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(!l.includes('--') && !/\d{4}/.test(l), l);
  assert.equal(lines.filter((l) => l.startsWith('사내 소형 생성 모델 장면')).length, 1);
  const withLlm = resolvePreset(customerOnpremFull, { ...defaultPlan('customer-onprem-full', 'visible'), full: true, localLlm: true, llmRequested: true });
  assert.ok(withLlm.inactiveRows.some((x) => x.stepId === 'S4-03' && x.reason.hidden), 'S4-03은 비활성이지만 고객 줄에 올리지 않는다');
  assert.ok(!omittedCustomerLines(withLlm.inactiveRows.filter((x) => !x.reason.hidden), []).some((l) => l.includes('예문 늘리기')));
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
function get(port: number, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, path }, (res) => {
      const c: Buffer[] = [];
      res.on('data', (x: Buffer) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(c).toString('utf8') }));
    })
      .on('error', reject)
      .end();
  });
}

test('H-T27: 무대 서버 — /roadmap?preset=full(풀 투어 템플릿) · /roadmap(10분판 템플릿 그대로) · /audio/utterance.wav · iframe allow 속성 · 오디오 블록', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-full-'));
  const wav = join(dir, 'u.wav');
  writeFileSync(wav, Buffer.from('RIFF....WAVEfmt '));
  const port = await freePort();
  let audio: string | null = wav;
  let allow = true;
  const srv = await startStageServer({
    port,
    assetsDir: repoPaths().assetsDir,
    values: () => ({ CONSOLE_URL: 'x', WIDGET_URL: 'x', API_BASE: 'x', STAGE_URL: 'x', MOTION: 'off', ROAD_ROWS: buildRoadmapRows() }),
    bots: () => ({}),
    audioFile: () => audio,
    siteAllow: () => allow,
    roadmapFull: () => ({ scenes: ['s1', 'voice'], omitted: ['사내 소형 생성 모델 장면 - 이번 구성에서 켜지 않아 보여 드리지 않았습니다'], excludeNos: [32] }),
  });
  try {
    const full = await get(port, '/roadmap?preset=full');
    assert.equal(full.status, 200);
    assert.ok(full.body.includes('오늘 보여 드린 2가지') && full.body.includes('이 PC 구성에서 생략한 장면') && !full.body.includes('No.32'));
    const plain = await get(port, '/roadmap');
    assert.ok(plain.body.includes('오늘 보여 드린 7가지') && plain.body.includes('No.32'), '10분판 로드맵은 그대로');
    const a = await get(port, '/audio/utterance.wav');
    assert.equal(a.status, 200);
    assert.ok(a.type.startsWith('audio/wav'));
    const stage = await get(port, '/stage');
    assert.ok(stage.body.includes('allow="microphone"') && stage.body.includes('id="voice-play"') && stage.body.includes('id="voice-audio"'));
    audio = null;
    allow = false;
    assert.equal((await get(port, '/audio/utterance.wav')).status, 404);
    const off = await get(port, '/stage');
    assert.ok(!off.body.includes('allow="microphone"') && !off.body.includes('voice-play') && !off.body.includes('{{'));
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── H-T28 ──
function step(over: Partial<StepResult> & Pick<StepResult, 'id' | 'segment'>): StepResult {
  return { title: '단계', core: true, status: 'PASS', budgetSec: 15, actualSec: 3, captures: [], ...over };
}

function baseInput(over: Partial<BuildInput> = {}): BuildInput {
  const steps = [step({ id: 'S0-01', segment: 'opening' })];
  const sc: ScenarioResult = { segments: [{ key: 'opening', title: '시작', budgetSec: 20, actualSec: 3, steps }], steps, showSec: 3, pausedSec: 0, gifClips: [], warnings: [] };
  return {
    runId: '20261002-143012-a7k2',
    presetId: 'customer-onprem-10m',
    mode: 'headless-check',
    exitCode: 0,
    startedAt: '2026-10-02T14:30:12+09:00',
    showStartedAt: null,
    endedAt: '2026-10-02T14:48:00+09:00',
    prepareSec: 10,
    machine: { os: 'Windows', cpu: 'cpu', cores: 8, ramGb: 16, freeRamGb: 8, gpu: 'RTX 3050' },
    commit: { sha: 'a'.repeat(40), dirty: false },
    browser: { kind: 'msedge', version: '154', playwright: '1.63.0', video: false },
    viewport: { width: 1920, height: 1080 },
    latency: null,
    overrides: [],
    embeddingUrl: '127.0.0.1:8100',
    blocked: [],
    network: { offline: true, checkedAt: null },
    scenario: sc,
    segments: customerOnprem10m.segments.slice(0, 1),
    skipOptionIds: [],
    dataset: null,
    calibration: [],
    calibrated: false,
    teardown: { processesLeft: 0, portsFreed: true, devDbUnchanged: true },
    prepare: [],
    media: { video: null, videoReason: null, vtt: null, gifs: [] },
    warnings: [],
    customerCopy: false,
    ...over,
  };
}

const DT2_KEYS = ['plan', 'models', 'vram', 'vramMax', 'speech', 'localLlm', 'downloads', 'proactive', 'badgeNotes', 'audioStoreCheck', 'childOverrides'];

function fullInput(): FullReportInput {
  const rt = createFullRuntime({ ...DEFAULT_OPTIONS, preset: 'customer-onprem-full', withVoiceInput: true, withLocalLlm: true }, customerOnpremFull);
  rt.plan = { ...rt.plan, voiceInput: 'real', sttDevice: 'cuda', sttModel: 'large-v3-turbo', deviceNote: null };
  refreshResolved(rt);
  const sp = buildStagePlan(rt);
  return {
    plan: { voiceInput: 'real', sttDevice: 'cuda', sttModel: 'large-v3-turbo', sttRequested: 'auto', localLlm: true, liveClustering: false, voiceOmittedReason: null, llmOmittedReason: null, deviceNote: null, gpuUse: 'both', gpuUseText: sp.gpuUseText, sceneCount: sp.sceneCount, totalBudgetSec: sp.totalSec, inactive: rt.resolved.inactiveRows.map((x) => ({ id: x.stepId, reason: x.reason.internal, customer: x.reason.hidden ? null : '생략' })), omittedLines: sp.omittedLines, sceneTitles: sp.sceneTitles, demonstratedNos: sp.demonstratedNos },
    models: [
      { role: 'embed', port: 8100, backend: 'sentence-transformers', modelId: 'nlpai-lab/KURE-v1@main', device: 'cpu' },
      { role: 'speech', port: 8102, backend: 'faster-whisper', modelId: 'large-v3-turbo', device: 'cuda', computeType: 'int8', fallbackFrom: null },
      { role: 'augment', port: 8101, backend: 'ollama', modelId: 'ollama:qwen3:4b-instruct-2507-q4_K_M', device: 'external', profile: 'lightweight', targetCap: 20 },
    ],
    vram: [{ at: '2026-10-02T14:31:00+09:00', event: 'T0', usedMiB: 1020, totalMiB: 4096 }],
    vramMax: [{ label: '장면 8 최대', usedMiB: 1053 }],
    speech: { expected: '주문 취소하면 환불은 언제 되나요', keywords: ['환불'], gateTranscript: '주문 취소하면 환불은 언제 되나요?', gateRatio: 1, transcript: '주문 취소하면 환불은 언제 되나요', matchRatio: 1, keywordsOk: true, intentOk: true, wavSec: 3.79, wavBytes: 363000, recordedMime: 'audio/webm;codecs=opus', source: 'BROWSER', listen: 'PLAYED', speaker: 'PLAYED' },
    prepared: { providerId: 'local', degraded: false, fallbackFrom: null, candidates: 18, elapsedMs: 15000, source: 'PREPARED', intentName: '회원정보' },
    live: { providerId: 'local', degraded: false, fallbackFrom: null, candidates: 17, elapsedMs: 16000, source: 'LIVE', intentName: '주문변경' },
    loadMs: 5000,
    unloaded: true,
    downloads: [{ stepId: 'S7-06', file: 'downloads/utterance-analysis-20261002-abcd1234.xlsx', bytes: 11144, via: 'BROWSER', auditRows: 68, signature: '504b0304' }],
    proactive: { shown: 2, clicked: 1, optedOut: 1 },
    honesty: [{ stepId: 'SV-03', kind: 'SYNTHETIC_INPUT', text: '합성 음성 파일을 가상 마이크로 넣었습니다' }, { stepId: null, kind: 'NO_AUDIO', text: '영상에는 소리가 없습니다' }],
    badgeNotes: [{ stepId: 'S1-04', shown: ['GPU 사용'], hidden: [{ badge: 'CPU 동작', why: '지금 GPU를 쓰는 것이 있어 표시하지 않음' }] }],
    gpuUsed: true,
    childOverrides: [{ key: 'STT_DEVICE', value: 'cuda', defaultValue: 'cpu', reason: '음성 인식 장치 GPU', disclosed: true }],
    audioStoreCheck: { scannedFiles: 12, hits: [], logHits: [] },
  };
}

test('H-T28: 10분판 result.json — v1 키 집합 그대로(DT-2 선택 키 0 · gpuUsedByHarness=false) · tool은 DT-1', () => {
  const r = buildResult(baseInput());
  for (const k of DT2_KEYS) assert.equal(k in r, false, k);
  assert.equal(r.machine.gpuUsedByHarness, false);
  assert.equal(r.tool, 'DT-1');
  assert.equal(parseResult(JSON.stringify(r)).schemaVersion, 1);
  // 10분판 보고서 HTML에는 풀 투어 절이 없다
  const html = renderReport(r, { customer: false });
  for (const id of ['s-speech', 's-models', 's-localllm', 's-proactive', 's-downloads', 's-badges']) assert.ok(!html.includes(`id="${id}"`), id);
  assert.ok(html.includes('하네스 사용: AI 추론에는 GPU를 쓰지 않음'));
  assert.ok(!html.includes('이번 구성에서 생략'));
});

test('H-T28: 풀 투어 result.json 왕복 — 선택 키 전부 · gpuUsedByHarness=true 허용 · 정직성 신규 종류 · 포트·모델 표', () => {
  const r = buildResult(baseInput({ presetId: 'customer-onprem-full', full: fullInput() }));
  const back = parseResult(JSON.stringify(r));
  for (const k of ['plan', 'models', 'vram', 'vramMax', 'speech', 'localLlm', 'downloads', 'proactive', 'badgeNotes', 'audioStoreCheck']) assert.ok(k in back, k);
  assert.equal(back.machine.gpuUsedByHarness, true);
  assert.equal(back.plan?.gpuUse, 'both');
  assert.equal(back.models?.length, 3);
  assert.equal(back.speech?.source, 'BROWSER');
  assert.ok(back.honesty.some((h) => h.kind === 'SYNTHETIC_INPUT') && back.honesty.some((h) => h.kind === 'NO_AUDIO'));
  assert.ok(!back.roadmap?.some((x) => x.featureNo === 32), '오늘 시연한 No.32는 로드맵 행에서 뺀다');
  assert.ok(back.egressChecklist.some((c) => c.item === 'ML_WORKER_SPEECH_URL · SPEECH_ENABLED' && c.state === 'LOOPBACK'));
  assert.ok(back.egressChecklist.some((c) => c.item === 'AUGMENTATION_LOCAL_BASE_URL' && c.state === 'LOOPBACK'));
  assert.ok(back.overrides.some((o) => o.key === 'STT_DEVICE'));
  assert.ok(renderSummary(back).includes('구성: 풀 투어'));
});

test('H-T28: 풀 투어 보고서 HTML — 신규 절 · 하네스 GPU 사용 문구 3종 · 내부판에만 내려받은 파일·배지 표시 내역 · 고객판은 downloads 링크 0 · 포트·게이트 전사 제외', () => {
  const r = parseResult(JSON.stringify(buildResult(baseInput({ presetId: 'customer-onprem-full', full: fullInput() }))));
  const internal = renderReport(r, { customer: false });
  const customer = renderReport(r, { customer: true });
  for (const id of ['s-speech', 's-models', 's-localllm', 's-proactive']) assert.ok(internal.includes(`id="${id}"`) && customer.includes(`id="${id}"`), id);
  assert.ok(internal.includes('id="s-downloads"') && internal.includes('utterance-analysis-20261002-abcd1234.xlsx'));
  assert.ok(internal.includes('id="s-badges"') && internal.includes('CPU 동작 표시 안 함'));
  assert.ok(!customer.includes('id="s-downloads"') && !customer.includes('downloads/') && !customer.includes('.xlsx') && !customer.includes('id="s-badges"'));
  assert.ok(!customer.includes('audio/webm') && !customer.includes('363000') && !customer.includes('게이트 전사'), '고객판은 녹음 형식·바이트·게이트 전사 제외');
  assert.ok(internal.includes('audio/webm') && internal.includes('게이트 전사'));
  assert.ok(internal.includes('음성 인식과 사내 소형 생성 모델이 이 PC의 GPU를 순서대로 사용했습니다'));
  assert.ok(internal.includes('정확도 판정이 아닙니다') && internal.includes('GPU 메모리 관찰값 — 합격 판정에 쓰지 않습니다') && internal.includes('동작 확인 수준'));
  assert.ok(internal.includes('영상에는 소리가 없습니다 — 현장 스피커로만 들립니다'));
  for (const html of [internal, customer]) {
    assert.ok(!html.includes('://'), '외부 URL 0');
    assert.ok(!html.includes('<script'), '스크립트 0');
    assert.ok(html.startsWith('<!doctype html>') && html.includes('lang="ko"'));
  }
  const stt = parseResult(JSON.stringify({ ...r, plan: { ...r.plan!, gpuUse: 'stt' } }));
  assert.ok(renderReport(stt, { customer: false }).includes('음성 인식(large-v3-turbo)이 이 PC의 GPU를 사용했습니다. 문장 분석(임베딩)은 CPU입니다'));
  const llm = parseResult(JSON.stringify({ ...r, plan: { ...r.plan!, gpuUse: 'llm' } }));
  assert.ok(renderReport(llm, { customer: false }).includes('사내 소형 생성 모델(Ollama)이 이 PC의 GPU를 사용했습니다(장면 10)'));
});

test('옵션 생략(OPTION) 단계 끼워 넣기 — 원래 순서 · 구간 전체 생략은 새 구간 · 건너뜀 집계에서는 OPTION을 따로 센다 · --only 선택 존중', () => {
  const rt = createFullRuntime({ ...DEFAULT_OPTIONS, preset: 'customer-onprem-full' }, customerOnpremFull);
  const r = resolvePreset(customerOnpremFull, rt.plan);
  const mk = (id: string, segment: string): StepResult => step({ id, segment });
  const sc: ScenarioResult = {
    segments: [
      { key: 'voice', title: '음성 응대', budgetSec: 95, actualSec: 1, steps: [mk('SV-01', 'voice'), mk('SV-02', 'voice'), mk('SV-05', 'voice'), mk('SV-06', 'voice'), mk('SV-07', 'voice')] },
      { key: 'closing', title: '마무리', budgetSec: 20, actualSec: 1, steps: [mk('S9-01', 'closing')] },
    ],
    steps: [],
    showSec: 1,
    pausedSec: 0,
    gifClips: [],
    warnings: [],
  };
  sc.steps = sc.segments.flatMap((s) => s.steps);
  const m = mergeInactiveRows(sc, customerOnpremFull, r, null);
  const ids = sc.steps.map((s) => s.id);
  assert.deepEqual(ids.filter((i) => i.startsWith('SV-')), ['SV-01', 'SV-02', 'SV-03', 'SV-04', 'SV-05', 'SV-06', 'SV-07', 'SV-08'], 'SV-03·04·08이 원래 위치에 끼워진다');
  assert.ok(ids.includes('SE-01') && ids.indexOf('SE-01') < ids.indexOf('S9-01'), '구간 전체(edge) 생략은 새 구간으로 마무리 앞에');
  assert.equal(m.extraSegments.map((s) => s.key).join(','), 's7,edge', '결과에 없던 구간(s7 · edge)의 옵션 생략 행은 새 구간으로 전역 순서에 맞게');
  assert.ok(sc.steps.filter((s) => s.status === 'SKIPPED' && s.skipReason === 'OPTION').every((s) => (s.honesty?.[0] ?? '').includes('옵션 미지정')));
  // 선택 실행(--only voice): 다른 구간의 비활성 행은 넣지 않는다
  const sc2: ScenarioResult = { segments: [{ key: 'voice', title: '음성 응대', budgetSec: 95, actualSec: 1, steps: [mk('SV-01', 'voice')] }], steps: [mk('SV-01', 'voice')], showSec: 1, pausedSec: 0, gifClips: [], warnings: [] };
  const m2 = mergeInactiveRows(sc2, customerOnpremFull, r, ['voice']);
  assert.equal(m2.extraSegments.length, 0);
  assert.ok(!sc2.steps.some((s) => s.id.startsWith('SE-') || s.id === 'S7-07'));
});

test('음성 원본 저장 0 확인 — 시그니처(RIFF/WAVE · OggS · EBML)를 찾고 제외 폴더는 건너뛴다 · 서버 로그의 인식 글자를 찾는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-scan-'));
  try {
    writeFileSync(join(dir, 'demo.db'), Buffer.from('SQLite format 3\0plain bytes only'));
    writeFileSync(join(dir, 'state.json'), '{}');
    const clean = scanAudioTraces(dir, ['주문 취소하면 환불은 언제 되나요']);
    assert.deepEqual([clean.hits, clean.logHits], [[], []]);
    assert.ok(clean.scannedFiles >= 2);
    writeFileSync(join(dir, 'leak.bin'), Buffer.concat([Buffer.alloc(3), Buffer.from('RIFF....WAVEfmt ')]));
    writeFileSync(join(dir, 'ogg.bin'), Buffer.concat([Buffer.from('OggS'), Buffer.from([0, 2]), Buffer.alloc(8)])); // M-2: OggS·EBML은 파일 맨 앞일 때만 인정
    writeFileSync(join(dir, 'webm.bin'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]));
    const bad = scanAudioTraces(dir, []);
    assert.deepEqual(bad.hits.map((h) => h.split(':')[0]).sort(), ['leak.bin', 'ogg.bin', 'webm.bin']);
    // 제외 폴더(audio)는 건너뛴다
    rmSync(join(dir, 'leak.bin'));
    rmSync(join(dir, 'ogg.bin'));
    rmSync(join(dir, 'webm.bin'));
    mkdirSync(join(dir, 'audio'));
    writeFileSync(join(dir, 'audio', 'utterance.wav'), Buffer.from('RIFF....WAVEfmt '));
    assert.deepEqual(scanAudioTraces(dir, []).hits, []);
    mkdirSync(join(dir, 'logs'));
    writeFileSync(join(dir, 'logs', 'api.log'), '요청 처리: 주문 취소하면 환불은 언제 되나요\n');
    assert.equal(scanAudioTraces(dir, ['주문 취소하면 환불은 언제 되나요']).logHits.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('계획 요약(/__facts.plan) — 서버 이름 · GPU 사용 · 출구 · 증강 · 장면 이름(고객 쉬운 말)', () => {
  const rt = createFullRuntime({ ...DEFAULT_OPTIONS, preset: 'customer-onprem-full', withLocalLlm: true }, customerOnpremFull);
  const p = buildStagePlan(rt);
  assert.deepEqual(p.servers, ['API', '문장 분석', '소형 생성']);
  assert.equal(p.gpuUse, 'llm');
  assert.deepEqual(p.egressNames, ['문장 분석', '소형 생성']);
  assert.equal(p.augmentation, 'local');
  assert.equal(p.sceneCount, 10);
  assert.equal(p.sceneTitles.length, 10);
  assert.deepEqual(p.demonstratedNos, [32]);
  assert.equal(p.voice.state, 'NOT_REQUESTED');
  assert.deepEqual(p.omittedLines, ['음성으로 묻기(눌러서 말하기) - 이번 구성에서 켜지 않아 보여 드리지 않았습니다']);
  assert.equal(emptyRecord().micOpened, 0);
});


test('M-2: 음성 원본 흔적 검사 — ml-speech(STT 자식 cwd)도 검사 · 앞 64KB만 읽음 · 확장자 · SQLite 4바이트 우연 일치 오탐 완화', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-scan2-'));
  try {
    mkdirSync(join(dir, 'ml-speech'));
    writeFileSync(join(dir, 'ml-speech', 'tmp1.dat'), Buffer.concat([Buffer.from('RIFF    WAVEfmt '), Buffer.alloc(32)]));
    writeFileSync(join(dir, 'ml-speech', 'rec.webm'), Buffer.from('not really audio'));
    writeFileSync(join(dir, 'ml-speech', 'head.bin'), Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]));
    // 오탐 완화: SQLite 안에서 우연히 나온 4바이트(맨 앞이 아님)는 무시
    writeFileSync(join(dir, 'demo.db'), Buffer.concat([Buffer.from('SQLite format 3 '), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('OggS'), Buffer.alloc(64)]));
    // 큰 파일: 64KB 뒤의 시그니처는 읽지 않는다(메모리 전체 로드 없음 — 알려진 한계)
    writeFileSync(join(dir, 'big.bin'), Buffer.concat([Buffer.alloc(SCAN_HEAD_BYTES + 10), Buffer.from('RIFF    WAVEfmt ')]));
    const r = scanAudioTraces(dir, []);
    const names = r.hits.map((h) => h.split(':')[0]).sort();
    assert.deepEqual(names, ['ml-speech/head.bin', 'ml-speech/rec.webm', 'ml-speech/tmp1.dat']);
    assert.ok(r.hits.some((h) => h.startsWith('ml-speech/rec.webm') && h.includes('확장자')));
    assert.ok(!names.includes('demo.db') && !names.includes('big.bin'));
    // 다른 제외 폴더는 여전히 건너뛴다
    mkdirSync(join(dir, 'video'));
    writeFileSync(join(dir, 'video', 'x.webm'), Buffer.from('x'));
    assert.ok(!scanAudioTraces(dir, []).hits.some((h) => h.startsWith('video/')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-1: STT_MODEL_ID 로컬 절대경로는 result.json·고객판·내부판 어디에도 나가지 않는다(모델 이름만)', () => {
  const abs = 'D:/2. Team Source/Chat Bot/apps/ml-worker/.cache/stt-models/large-v3-turbo';
  const input = baseInput({
    presetId: 'customer-onprem-full',
    overrides: [{ key: 'STT_MODEL_ID', value: abs, defaultValue: '(없음)', reason: '로컬 모델 폴더', disclosed: true }],
    full: { ...fullInput(), childOverrides: [{ key: 'STT_MODEL_ID', value: abs, defaultValue: '(없음)', reason: '로컬 모델 폴더', disclosed: true }] },
  });
  const r = buildResult(input);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('Team Source') && !/[A-Za-z]:[\/]/.test(json.replace(/"at":"[^"]*"/g, '')), 'result.json에 드라이브 문자 경로 0');
  assert.equal(r.overrides.find((o) => o.key === 'STT_MODEL_ID')?.value, 'large-v3-turbo');
  const back = parseResult(json);
  for (const customer of [true, false]) {
    const html = renderReport(back, { customer });
    assert.ok(!html.includes('Team Source') && !/[A-Za-z]:[\/]/.test(html), `customer=${customer} 렌더링에 드라이브 문자 경로 0`);
  }
  // 이미 경로가 실린 result.json(구버전)을 읽어도 고객판은 경로를 가린다
  const legacy = parseResult(JSON.stringify({ ...r, overrides: [{ key: 'STT_MODEL_ID', value: abs, default: '(없음)', reason: 'r' }] }));
  const cust = renderReport(legacy, { customer: true });
  assert.ok(!cust.includes('Team Source') && cust.includes('(내부 경로)'));
});
