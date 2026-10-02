// 코드 리뷰 1차 수정 시험 — H-1(회수 판정은 full-gpu.test.ts) · M-1~M-3 · L-1 · L-4 · L-6 · L-7
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTypedFallback } from '../src/scenarios/full/voice';
import { KEYWORD_PATH_MIN_RATIO, judgeTranscript, normalizeForMatch } from '../src/voice/match';
import { VOICE_PHRASE } from '../src/data/dataset-full';
import { bringUpSpeech, createFullRuntime, gateDx1 } from '../src/orchestrator/full-prepare';
import { DEFAULT_OPTIONS } from '../src/cli/args';
import { customerOnpremFull } from '../src/presets/customer-onprem-full';
import { WaitAbortedError } from '../src/util/wait-for';
import { guarded } from '../src/util/guarded';
import { isPathLike, publicOverrideValue } from '../src/report/public-value';
import { checkPresetDefinition } from '../src/scenario/definition-check';
import type { SpeechRecord } from '../src/scenario/full-env';

// ── L-4 ──
test('L-4: 핵심어 한 단어만 전사돼도 통과하던 문제 — 일치율 하한(0.5)과 핵심어 2개', () => {
  assert.equal(KEYWORD_PATH_MIN_RATIO, 0.5);
  assert.ok(VOICE_PHRASE.keywords.length >= 2);
  const e = VOICE_PHRASE.expected;
  assert.equal(judgeTranscript(e, '환불', ['환불']).textOk, false, '핵심어 하나만 들린 전사는 실패');
  assert.equal(judgeTranscript(e, '환불', VOICE_PHRASE.keywords).textOk, false);
  assert.equal(judgeTranscript(e, '환불 신청은 아무 때나 하세요 그리고 아주 긴 다른 말', ['환불']).textOk, false, '핵심어만 맞고 일치율이 하한 미만이면 실패');
  assert.equal(judgeTranscript(e, '환불은 언제 되나요', VOICE_PHRASE.keywords).textOk, true, '일부 누락이어도 핵심어 전부 + 일치율 ≥ 0.5');
  // DX-3 정정 문장은 그대로 통과(정확 일치 · 문장부호·띄어쓰기 차이)
  for (const t of ['주문 취소하면 환불은 언제 되나요', '주문 취소하면 환불은 언제 되나요?', '주문취소하면 환불은 언제되나요.']) assert.equal(judgeTranscript(e, t, VOICE_PHRASE.keywords).textOk, true, t);
});

test('L-4: 제로폭 등 보이지 않는 서식 문자(Cf)는 정규화에서 제거', () => {
  assert.equal(normalizeForMatch('환\u200b불\u2060은\ufeff 언제'), '환불은언제');
  assert.equal(judgeTranscript(VOICE_PHRASE.expected, '주문\u200b 취소하면 환불은 언제 되나요', VOICE_PHRASE.keywords).ratio, 1);
});

test('L-4: 게이트 G-DX-1 — 전사가 핵심어 한 단어면 실패(합성 음성 API 스텁)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-gate-'));
  const wav = join(dir, 'a.wav');
  writeFileSync(wav, Buffer.from('RIFF'));
  let transcript = '환불';
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: transcript, empty: false }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const a = { apiBase: `http://127.0.0.1:${port}`, slug: 's', origin: 'http://127.0.0.1:1', wavPath: wav, expected: VOICE_PHRASE.expected, keywords: VOICE_PHRASE.keywords };
    assert.equal((await gateDx1(a)).ok, false);
    transcript = VOICE_PHRASE.expected;
    assert.equal((await gateDx1(a)).ok, true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── L-6 ──
test('L-6: SV-03 글자 입력 대체 — 전사를 기대 문장으로 바꾸면서 직전 실패 판정값(일치율·핵심어)을 비운다', () => {
  const rec: SpeechRecord = { expected: 'x', keywords: ['k'], gateTranscript: null, gateRatio: null, transcript: '엉뚱', matchRatio: 0.12, keywordsOk: false, intentOk: null, wavSec: 1, wavBytes: 1, recordedMime: null, source: 'BROWSER', listen: null, speaker: null };
  applyTypedFallback(rec, '주문 취소하면 환불은 언제 되나요');
  assert.deepEqual([rec.source, rec.transcript, rec.matchRatio, rec.keywordsOk], ['TYPED_FALLBACK', '주문 취소하면 환불은 언제 되나요', null, null]);
});

// ── M-3 ──
function fakeDeps(startChild: () => Promise<void>, signal: AbortSignal) {
  const calls = { start: 0, stop: 0 };
  const run = mkdtempSync(join(tmpdir(), 'dh-bring-'));
  const supervisor = {
    startChild: async () => {
      calls.start++;
      await startChild();
    },
    stopChild: async () => {
      calls.stop++;
    },
    find: () => ({ exited: false, pid: 0, tail: () => [] as string[] }),
  };
  const d = {
    supervisor,
    run: { dir: run, logs: run, runId: 'r' },
    paths: { venvPython: 'python', mlWorkerDir: run },
    ports: { mlSpeech: 1 },
    parentEnv: {},
    redact: (s: string) => s,
    signal,
    log: () => undefined,
  };
  return { d, calls, cleanup: () => rmSync(run, { recursive: true, force: true }) };
}

function fakeRt() {
  const rt = createFullRuntime({ ...DEFAULT_OPTIONS, preset: 'customer-onprem-full', withVoiceInput: true }, customerOnpremFull);
  rt.plan = { ...rt.plan, voiceInput: 'real', sttDevice: 'cuda', sttModel: 'large-v3-turbo', sttRequested: 'auto' };
  rt.pre = { voice: { facts: { smallCache: true } } } as never;
  return rt;
}

test('M-3: 중단 신호(WaitAbortedError)는 small·cpu 재기동으로 이어지지 않고 그대로 전파된다', async () => {
  const ac = new AbortController();
  const x = fakeDeps(async () => {
    ac.abort();
    throw new WaitAbortedError('음성 인식 서버');
  }, ac.signal);
  try {
    await assert.rejects(() => bringUpSpeech(fakeRt(), x.d as never), (e) => e instanceof WaitAbortedError);
    assert.equal(x.calls.start, 1, '재기동 없음');
  } finally {
    x.cleanup();
  }
});

test('M-3: signal이 이미 aborted면 일반 오류여도 삼키지 않는다 · 중단이 아닌 실패는 기존대로 small·cpu 폴백 1회', async () => {
  const ac = new AbortController();
  ac.abort();
  const a = fakeDeps(async () => {
    throw new Error('boom');
  }, ac.signal);
  try {
    await assert.rejects(() => bringUpSpeech(fakeRt(), a.d as never), /boom/);
    assert.equal(a.calls.start, 1);
  } finally {
    a.cleanup();
  }
  const live = new AbortController();
  const b = fakeDeps(async () => {
    throw new Error('cuda fail');
  }, live.signal);
  try {
    const r = await bringUpSpeech(fakeRt(), b.d as never);
    assert.equal(r.ok, false);
    assert.equal(b.calls.start, 2, 'cuda 시도 + small·cpu 폴백');
  } finally {
    b.cleanup();
  }
});

// ── L-1 ──
test('L-1: 정리 호출 하나가 던져도 다음 정리가 실행된다(guarded) · 오류 보고 자체의 실패도 삼킨다', async () => {
  const errs: string[] = [];
  const onError = (e: Error) => errs.push(e.message);
  await guarded(() => {
    throw new Error('close 실패');
  }, undefined, onError);
  assert.equal(await guarded(async () => Promise.reject(new Error('x')), 'fb', onError), 'fb');
  assert.equal(await guarded(() => 7, 0, onError), 7);
  await guarded(
    () => {
      throw new Error('y');
    },
    undefined,
    () => {
      throw new Error('보고 자체 실패');
    },
  );
  assert.deepEqual(errs, ['close 실패', 'x']);
});

// ── M-1 ──
test('M-1: 경로형 값 판정 · 공개값 일반화 — 모델 이름만 · 그 밖은 (내부 경로)', () => {
  for (const v of ['D:/2. Team Source/Chat Bot/apps/ml-worker/.cache/stt-models/large-v3-turbo', 'C:\\Users\\x\\m', '/home/u/m', '\\\\srv\\share\\m', 'a/b']) assert.equal(isPathLike(v), true, v);
  for (const v of ['cuda', 'http://127.0.0.1:8100', '1', '', 'large-v3-turbo', '(없음)']) assert.equal(isPathLike(v), false, v);
  assert.equal(publicOverrideValue('STT_MODEL_ID', 'D:/2. Team Source/Chat Bot/apps/ml-worker/.cache/stt-models/large-v3-turbo'), 'large-v3-turbo');
  assert.equal(publicOverrideValue('STT_MODEL_ID', 'C:\\Users\\kim\\models\\small\\'), 'small');
  assert.equal(publicOverrideValue('X_DIR', 'C:\\Users\\kim\\x'), '(내부 경로)');
  assert.equal(publicOverrideValue('STT_DEVICE', 'cuda'), 'cuda');
});

// ── L-7 ──
test('L-7: 정의 검사 — 풀 투어 프리셋의 inactive:option 단계에는 사유가 모두 있다', () => {
  const issues = checkPresetDefinition(customerOnpremFull);
  assert.deepEqual(issues.filter((i) => i.message.includes('inactiveReason')), []);
});

test('L-7: 사유가 빠진 inactive:option 단계는 정의 검사가 잡는다', () => {
  const bad = { ...customerOnpremFull, segments: customerOnpremFull.segments.map((seg) => ({ ...seg, steps: seg.steps.map((st) => (st.inactive === 'option' ? { ...st, inactiveReason: undefined } : st)) })) };
  assert.ok(checkPresetDefinition(bad).some((i) => i.message.includes('inactiveReason')));
});
