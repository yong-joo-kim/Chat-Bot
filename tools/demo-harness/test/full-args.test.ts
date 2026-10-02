// H-T20: 풀 투어 인자 — 새 옵션 5종 · 조합 오류 7종(설계 §4.2 · ui-spec §16.4.2) · 단계 ID 정규식 · 구간 키
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_TEXT, parseArgs } from '../src/cli/args';

const FULL = ['--preset', 'customer-onprem-full'];

function ok(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  return (r as Extract<typeof r, { ok: true }>).options;
}
function errs(argv: string[]) {
  const r = parseArgs(argv);
  assert.equal(r.ok, false, `오류가 나야 함: ${argv.join(' ')}`);
  return (r as Extract<typeof r, { ok: false }>).errors;
}

test('새 옵션 기본값: 모두 꺼짐 · 장치 auto(명시 아님)', () => {
  const o = ok(FULL);
  assert.equal(o.withVoiceInput, false);
  assert.equal(o.withLocalLlm, false);
  assert.equal(o.liveClustering, false);
  assert.equal(o.voiceMockCheck, false);
  assert.equal(o.sttDevice, 'auto');
  assert.equal(o.sttDeviceExplicit, false);
});

test('풀 투어: 플래그 3종 · 장치 3값 · 장치 명시 여부', () => {
  const o = ok([...FULL, '--with-voice-input', '--with-local-llm', '--live-clustering']);
  assert.deepEqual([o.withVoiceInput, o.withLocalLlm, o.liveClustering], [true, true, true]);
  assert.equal(ok([...FULL, '--with-voice-input', '--stt-device', 'cpu']).sttDevice, 'cpu');
  assert.equal(ok([...FULL, '--with-voice-input', '--stt-device=cuda']).sttDeviceExplicit, true);
  assert.equal(ok([...FULL, '--with-voice-input', '--stt-device', 'auto']).sttDeviceExplicit, false);
  assert.ok(errs([...FULL, '--with-voice-input', '--stt-device', 'tpu'])[0].what.includes('--stt-device'));
  assert.equal(ok([...FULL, '--mode', 'headless-check', '--voice-mock-check']).voiceMockCheck, true);
});

test('조합 오류 ① 10분판(또는 플래그를 받지 않는 프리셋) + 새 옵션 5종 → 풀 투어 안내', () => {
  for (const flag of ['--with-voice-input', '--with-local-llm', '--live-clustering']) {
    const e = errs([flag]);
    assert.equal(e.length, 1, flag);
    assert.ok(e[0].what.includes(flag) && e[0].what.includes('풀 투어'), e[0].what);
    assert.ok(e[0].how.includes('--preset customer-onprem-full'));
  }
  assert.ok(errs(['--stt-device', 'cpu'])[0].what.includes('풀 투어'));
  assert.ok(errs(['--mode', 'headless-check', '--voice-mock-check'])[0].what.includes('풀 투어'));
});

test('조합 오류 ② --stt-device는 --with-voice-input과 함께만', () => {
  const e = errs([...FULL, '--stt-device', 'cpu']);
  assert.ok(e[0].what.includes('--with-voice-input'));
  assert.ok(e[0].how.includes('--stt-device cpu'));
});

test('조합 오류 ③④ --voice-mock-check는 무인 점검 전용 · 실제 음성 입력과 함께 못 쓴다', () => {
  assert.ok(errs([...FULL, '--voice-mock-check'])[0].what.includes('보이는 시연'));
  assert.ok(errs([...FULL, '--voice-mock-check'])[0].how.includes('pnpm demo:check'));
  assert.ok(errs([...FULL, '--mode', 'headless-check', '--voice-mock-check', '--with-voice-input'])[0].what.includes('함께 쓸 수 없습니다'));
});

test('조합 오류 ⑤⑥ --only edge는 --with-local-llm 필요 · --appendix-llm은 풀 투어에서 못 쓴다', () => {
  assert.ok(errs([...FULL, '--only', 'edge'])[0].what.includes('장면 10'));
  assert.equal(ok([...FULL, '--only', 'edge', '--with-local-llm']).only?.[0], 'edge');
  assert.ok(errs([...FULL, '--mode', 'headless-check', '--appendix-llm'])[0].what.includes('풀 투어'));
});

test('조합 오류 ⑦ --only voice|proactive|edge는 그 구간이 있는 프리셋에서만', () => {
  for (const k of ['voice', 'proactive', 'edge']) assert.ok(errs(['--only', k])[0].what.includes(k), k);
  assert.deepEqual(ok([...FULL, '--only', 'proactive,voice,s1']).only, ['s1', 'voice', 'proactive']);
  assert.ok(errs([...FULL, '--only', 's8'])[0].how.includes('voice'));
});

test('단계 ID 정규식: 글자 코드 SV·SP·SE 허용(--skip · --inject-delay) · 8·10·11 같은 숫자 거부', () => {
  assert.deepEqual(ok([...FULL, '--skip', 'sv-06,SP-04,SE-01']).skip, ['SV-06', 'SP-04', 'SE-01']);
  assert.deepEqual(ok([...FULL, '--inject-delay', 'SE-01:5,S7-07:3']).injectDelay, { 'SE-01': 5, 'S7-07': 3 });
  assert.equal(errs([...FULL, '--skip', 'S8-01']).length, 1);
  assert.equal(errs([...FULL, '--skip', 'S10-01']).length, 1);
  assert.equal(errs([...FULL, '--inject-delay', 'S8-01:5']).length, 1);
  assert.equal(ok(['--resume', 'latest', '--from', 'SV']).from, 'SV');
});

test('도움말: 새 옵션 5종과 풀 투어 명령이 보인다', () => {
  for (const s of ['--with-voice-input', '--stt-device', '--with-local-llm', '--live-clustering', '--voice-mock-check', 'customer-onprem-full', 'voice proactive edge']) assert.ok(HELP_TEXT.includes(s), s);
});
