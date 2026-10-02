// H-T22(STT 장치 결정표 · 계획 확정) · H-T23(일치 판정) · H-T24(WAV 헤더 · SAPI 명령 인코딩) — DT-2 음성(설계 §5.2 · §7.3 · §9.8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cudaMissing, decideStt, STT_MIN_FREE_VRAM_MIB, type SttFacts } from '../src/voice/device';
import { judgeTranscript, keywordsAllIn, levenshtein, matchRatio, normalizeForMatch, MATCH_RATIO_THRESHOLD } from '../src/voice/match';
import { parseWavHeader } from '../src/voice/wav';
import { buildSapiScript, encodePowerShell, psQuote } from '../src/voice/synth';
import { findOnPath } from '../src/preflight/full-checks';
import { defaultPlan } from '../src/scenario/plan';
import { initialPlan, planFromPreflight } from '../src/orchestrator/full-prepare';
import type { LlmPreflight, VoicePreflight } from '../src/preflight/full-checks';

const GOOD: SttFacts = { packageOk: true, fakeMicOk: true, synthOk: true, gpuPresent: true, dllOk: true, vramFreeMiB: 3000, turboCache: true, smallCache: true };
const f = (o: Partial<SttFacts> = {}): SttFacts => ({ ...GOOD, ...o });

test('H-T22: auto — GPU·DLL·VRAM·turbo가 모두 되면 turbo·cuda', () => {
  const d = decideStt('auto', f());
  assert.equal(d.kind, 'RUN');
  if (d.kind === 'RUN') assert.deepEqual([d.device, d.model, d.note], ['cuda', 'large-v3-turbo', null]);
});

test('H-T22: auto — 조건 하나라도 모자라면 small·cpu(선택 공개) · small도 없으면 불가', () => {
  for (const o of [{ gpuPresent: false }, { dllOk: false }, { vramFreeMiB: STT_MIN_FREE_VRAM_MIB - 1 }, { vramFreeMiB: null }, { turboCache: false }]) {
    const d = decideStt('auto', f(o));
    assert.equal(d.kind, 'RUN', JSON.stringify(o));
    if (d.kind === 'RUN') {
      assert.deepEqual([d.device, d.model], ['cpu', 'small']);
      assert.equal(d.note?.kind, 'SELECTED');
      assert.ok(d.note!.reason.length > 0);
    }
  }
  const none = decideStt('auto', f({ gpuPresent: false, smallCache: false }));
  assert.equal(none.kind, 'UNAVAILABLE');
  assert.equal(decideStt('auto', f({ vramFreeMiB: STT_MIN_FREE_VRAM_MIB })).kind, 'RUN');
});

test('H-T22: cuda 명시 — 불가면 차단(대체하지 않는다) · cpu 명시 — small 없으면 차단(CPU로 turbo는 쓰지 않는다)', () => {
  assert.equal(decideStt('cuda', f()).kind, 'RUN');
  const b = decideStt('cuda', f({ dllOk: false, vramFreeMiB: 500 }));
  assert.equal(b.kind, 'BLOCK');
  if (b.kind === 'BLOCK') assert.ok(b.reason.includes('CUDA DLL') && b.reason.includes('500MiB'));
  assert.equal(decideStt('cuda', f({ turboCache: false })).kind, 'BLOCK');
  const cpu = decideStt('cpu', f());
  assert.equal(cpu.kind, 'RUN');
  if (cpu.kind === 'RUN') assert.deepEqual([cpu.device, cpu.model, cpu.note], ['cpu', 'small', null]);
  assert.equal(decideStt('cpu', f({ smallCache: false })).kind, 'BLOCK');
});

test('H-T22: 공통 조건(패키지 · 모델 둘 다 없음 · 가짜 마이크 · 합성 음성)이 빠지면 장치와 무관하게 불가', () => {
  for (const req of ['auto', 'cuda', 'cpu'] as const) {
    for (const o of [{ packageOk: false }, { fakeMicOk: false }, { synthOk: false }, { turboCache: false, smallCache: false }]) assert.equal(decideStt(req, f(o)).kind, 'UNAVAILABLE', `${req} ${JSON.stringify(o)}`);
  }
  assert.deepEqual(cudaMissing(f()), []);
  assert.equal(cudaMissing(f({ gpuPresent: false, dllOk: false })).length, 2, 'GPU 없음 · DLL 없음');
  assert.equal(cudaMissing(f({ vramFreeMiB: null, turboCache: false })).length, 2, '메모리 확인 못함 · turbo 없음');
});

function voice(over: Partial<VoicePreflight>): VoicePreflight {
  return { requested: true, mock: false, facts: GOOD, decision: null, mockUnavailable: null, wav: null, probe: null, ...over };
}
const noLlm: LlmPreflight = { requested: false, unavailableReason: null, loadedBefore: [], sameModelLoaded: false };
const opts = (o: Record<string, unknown> = {}) => ({ withVoiceInput: true, voiceMockCheck: false, sttDevice: 'auto' as const, sttDeviceExplicit: false, withLocalLlm: false, liveClustering: false, mode: 'visible' as const, ...o });

test('H-T22: 계획 확정 — 보이는 시연은 불가를 경고+생략(voiceInput=off · 사유) · 무인 점검은 차단 · 장치 명시 불가는 양쪽 차단', () => {
  const base = initialPlan('customer-onprem-full', opts());
  const unavail = voice({ decision: { kind: 'UNAVAILABLE', reason: '음성 인식 모델이 없습니다' } });
  const vis = planFromPreflight(base, opts(), unavail, noLlm);
  assert.equal(vis.blocks.length, 0);
  assert.equal(vis.plan.voiceInput, 'off');
  assert.equal(vis.plan.voiceOmittedReason, '음성 인식 모델이 없습니다');
  assert.equal(vis.omitted.length, 1);
  const hl = planFromPreflight({ ...base, mode: 'headless-check' }, opts({ mode: 'headless-check' }), unavail, noLlm);
  assert.equal(hl.blocks.length, 1);
  assert.ok(hl.blocks[0].how.includes('--voice-mock-check'));
  const blk = voice({ decision: { kind: 'BLOCK', reason: 'GPU 없음' } });
  for (const mode of ['visible', 'headless-check'] as const) assert.equal(planFromPreflight({ ...base, mode }, opts({ mode, sttDevice: 'cuda', sttDeviceExplicit: true }), blk, noLlm).blocks.length, 1, mode);
});

test('H-T22: 계획 확정 — RUN은 장치·모델·장치 선택 사실을 계획에 싣는다 · 생성(Ollama) 불가도 같은 원칙 · mock은 불가 사유가 있으면 차단', () => {
  const base = initialPlan('customer-onprem-full', opts({ withLocalLlm: true }));
  const run = planFromPreflight(base, opts({ withLocalLlm: true }), voice({ decision: { kind: 'RUN', device: 'cpu', model: 'small', note: { kind: 'SELECTED', reason: 'GPU 없음' } } }), { requested: true, unavailableReason: 'Ollama가 응답하지 않습니다', loadedBefore: [], sameModelLoaded: false });
  assert.deepEqual([run.plan.voiceInput, run.plan.sttDevice, run.plan.sttModel, run.plan.deviceNote?.kind], ['real', 'cpu', 'small', 'SELECTED']);
  assert.equal(run.plan.localLlm, false);
  assert.equal(run.plan.llmOmittedReason, 'Ollama가 응답하지 않습니다');
  assert.equal(run.omitted.length, 1);
  const mockBase = initialPlan('customer-onprem-full', opts({ withVoiceInput: false, voiceMockCheck: true, mode: 'headless-check' }));
  const mock = planFromPreflight(mockBase, opts({ withVoiceInput: false, voiceMockCheck: true, mode: 'headless-check' }), voice({ mock: true, mockUnavailable: '합성 음성을 만들지 못했습니다' }), noLlm);
  assert.equal(mock.blocks.length, 1);
  assert.equal(planFromPreflight(mockBase, opts({ withVoiceInput: false, voiceMockCheck: true, mode: 'headless-check' }), voice({ mock: true }), noLlm).plan.voiceInput, 'mock');
  // 요청하지 않으면 계획은 그대로
  const none = planFromPreflight(defaultPlan('x', 'visible'), opts({ withVoiceInput: false }), voice({ requested: false }), noLlm);
  assert.equal(none.plan.voiceInput, 'off');
});

test('H-T23: 정규화(NFC · 소문자 · 공백·문장부호 제거) · "알려 주세요" ↔ "알려주세요." · 편집 거리', () => {
  assert.equal(normalizeForMatch('환불 규정이, 어떻게 되나요?'), '환불규정이어떻게되나요');
  assert.equal(normalizeForMatch('ABC 가나다.'), 'abc가나다');
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', '가나'), 2);
  assert.equal(matchRatio('환불 규정이 어떻게 되는지 알려 주세요', '환불 규정이 어떻게 되는지 알려주세요.'), 1);
  assert.equal(matchRatio('', ''), 1);
  assert.equal(matchRatio('가', ''), 0);
});

test('H-T23: 경계 0.79/0.80 · 핵심어 · K0 사례("반불 규정이" 오인식은 핵심어 환불로도 실패 → 문장 교체 이유)', () => {
  assert.equal(MATCH_RATIO_THRESHOLD, 0.8);
  // 10글자 기준 2글자 틀리면 0.8 — 통과, 3글자 틀리면 0.7 — 일치율로는 실패
  const e = '가나다라마바사아자차';
  assert.equal(judgeTranscript(e, '가나다라마바사아카타', []).textOk, true);
  assert.equal(judgeTranscript(e, '가나다라마바사하하하', []).textOk, false);
  assert.equal(Math.round(matchRatio(e, '가나다라마바사하하하') * 100) / 100, 0.7);
  // 핵심어만으로도 통과(전부 포함)
  assert.equal(judgeTranscript('주문 취소하면 환불은 언제 되나요', '환불은 언제 되나요', ['환불']).textOk, true);
  assert.equal(keywordsAllIn('반불 규정이 어떻게', ['환불']), false);
  assert.equal(keywordsAllIn('환불 규정', ['환불', '규정']), true);
  assert.equal(judgeTranscript('x', 'y', []).keywordsOk, false);
  // 기본 문장(DX-3): small이 정확히 인식한 문장 — 원문 그대로 일치
  assert.equal(judgeTranscript('주문 취소하면 환불은 언제 되나요', '주문 취소하면 환불은 언제 되나요?', ['환불']).ratio, 1);
});

function wavBuf(opts: { rate?: number; ch?: number; bits?: number; seconds?: number; dataSize?: number }): Buffer {
  const rate = opts.rate ?? 48000;
  const ch = opts.ch ?? 1;
  const bits = opts.bits ?? 16;
  const bytes = Math.round((opts.seconds ?? 1) * rate * ch * (bits / 8));
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + bytes, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * ch * (bits / 8), 28);
  b.writeUInt16LE(ch * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(opts.dataSize ?? bytes, 40);
  return b;
}

test('H-T24: WAV 헤더 파서 — 48kHz mono 16bit 길이 · 스트리밍 data 크기(0) 대체 · 잘못된 파일', () => {
  const w = parseWavHeader(wavBuf({ seconds: 3.79 }));
  assert.equal(w.ok, true);
  assert.deepEqual([w.sampleRate, w.channels, w.bitsPerSample, w.format], [48000, 1, 16, 1]);
  assert.ok(Math.abs((w.durationSec ?? 0) - 3.79) < 0.001);
  const stream = parseWavHeader(wavBuf({ seconds: 2, dataSize: 0 }));
  assert.ok(Math.abs((stream.durationSec ?? 0) - 2) < 0.001);
  assert.equal(parseWavHeader(Buffer.from('not a wav file at all, definitely longer than forty-four bytes...')).ok, false);
  assert.equal(parseWavHeader(Buffer.alloc(10)).ok, false);
  assert.equal(parseWavHeader(wavBuf({ rate: 16000, seconds: 1 })).sampleRate, 16000);
});

test('H-T24: SAPI 명령 — UTF-16LE base64 왕복에서 한글 문장 보존 · 작은따옴표 이스케이프 · ProgressPreference · 무음 0.5초 · 48kHz mono 16bit', () => {
  const script = buildSapiScript("주문 취소하면 환불은 언제 되나요 (it's)", "D:\\2. Team Source\\x's\\audio\\utterance.wav");
  const decoded = Buffer.from(encodePowerShell(script), 'base64').toString('utf16le');
  assert.equal(decoded, script);
  assert.ok(decoded.includes('주문 취소하면 환불은 언제 되나요'));
  assert.ok(decoded.includes("it''s"), '작은따옴표 이스케이프');
  assert.ok(decoded.includes("x''s"), '경로의 작은따옴표 이스케이프');
  assert.ok(decoded.startsWith("$ProgressPreference='SilentlyContinue'"));
  assert.equal((decoded.match(/AppendBreak\(\[TimeSpan\]::FromMilliseconds\(500\)\)/g) ?? []).length, 2, '앞뒤 무음 0.5초');
  assert.ok(decoded.includes('SpeechAudioFormatInfo(48000') && decoded.includes('Sixteen') && decoded.includes('Mono'));
  assert.equal(psQuote("a'b"), "'a''b'");
});

test('DX-8: 시스템 PATH에서 DLL 찾기(대소문자 키 무관) — 없으면 null', () => {
  const dir = process.cwd();
  assert.equal(findOnPath('package.json', { Path: `C:\\none;${dir}` }), dir);
  assert.equal(findOnPath('no-such-file.dll', { PATH: dir }), null);
  assert.equal(findOnPath('x', {}), null);
});
