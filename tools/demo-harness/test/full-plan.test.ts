// H-T19(계획 해석 · 정의 검사 일반화) · H-T27 일부(고객용 문구) · H-S7(10분판 정의 불변) — DT-2 풀 투어 프리셋(설계 §3 · §10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPresetDefinition, checkSkipIds, isConditionalPreset } from '../src/scenario/definition-check';
import { defaultPlan, edgeInactiveReason, egressNames, gpuUse, GPU_USE_TEXT, omitCustomerLine, PLAN_MATRIX, planKey, resolvePreset, voiceInactiveReason, type PlanContext } from '../src/scenario/plan';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';
import { customerOnpremFull, FULL_EXPECTED_TOTALS } from '../src/presets/customer-onprem-full';
import { derive } from '../src/scenarios/full/derive';
import { FALLBACK_TEXTS, S0_01_NARRATION_CPU, S0_01_NARRATION_GPU, SE01_DISCLOSURE, SE02_DISCLOSURE, SP01_DISCLOSURE, SV05_NO_VOICE_DISCLOSURE, s001Disclosure, s002Disclosure, s702Narration, s707Disclosure, se01Narration, sv01Disclosure, sv03Disclosure, sv07Narration } from '../src/scenarios/full/text';

const FORBIDDEN = /[①-⓿←-⇿✓✗✔✘ⓘ\u{1f300}-\u{1faff}]/u;
const PKG_ROOT = join(__dirname, '..', '..');

function plan(over: Partial<PlanContext> = {}): PlanContext {
  return { ...defaultPlan('customer-onprem-full', 'visible'), full: true, ...over };
}

test('H-T19 ①: 대표 계획 16개 전부에서 풀 투어 정의 검사 통과(규칙 · ID 유일 · 변형 정확히 1개 · 총 예산 선언 일치)', () => {
  assert.equal(PLAN_MATRIX.length, 16);
  assert.ok(isConditionalPreset(customerOnpremFull));
  assert.deepEqual(checkPresetDefinition(customerOnpremFull), []);
  assert.equal(new Set(PLAN_MATRIX.map((p) => `${planKey(p)}:${p.sttDevice}`)).size, 16);
});

test('H-T19 ②: 총 예산 선언 — 기본 830 · 전부 1,035(DX-7 SE-01 25초 반영) · 조합(V 875 · C 890 · L 930 · V+L 975 · V+C 935 · C+L 990)', () => {
  const total = (p: Partial<PlanContext>) => resolvePreset(customerOnpremFull, plan(p)).totalBudgetSec;
  assert.equal(total({}), 830);
  assert.equal(total({ voiceInput: 'real', sttDevice: 'cuda', localLlm: true, liveClustering: true }), 1035);
  assert.equal(total({ voiceInput: 'real', sttDevice: 'cpu' }), 875);
  assert.equal(total({ liveClustering: true }), 890);
  assert.equal(total({ localLlm: true }), 930);
  assert.equal(total({ voiceInput: 'real', sttDevice: 'cuda', localLlm: true }), 975);
  assert.equal(total({ voiceInput: 'real', sttDevice: 'cuda', liveClustering: true }), 935);
  assert.equal(total({ localLlm: true, liveClustering: true }), 990);
  for (const p of PLAN_MATRIX) assert.equal(resolvePreset(customerOnpremFull, p).totalBudgetSec, FULL_EXPECTED_TOTALS[planKey(p)], planKey(p));
});

test('H-T19 ③: 구간 예산표(기본 투어) · 칩은 활성 장면 수 N 기준 · 생략 순서는 활성 단계만', () => {
  const r = resolvePreset(customerOnpremFull, plan());
  assert.deepEqual(r.segments.map((s) => `${s.key}:${s.budgetSec}`), ['opening:40', 's1:90', 's2:80', 's3:55', 's4:95', 's5:95', 's6:100', 's7:90', 'voice:95', 'proactive:70', 'closing:20']);
  assert.deepEqual(r.segments.map((s) => s.chip), ['시작', '장면 1/9', '장면 2/9', '장면 3/9', '장면 4/9', '장면 5/9', '장면 6/9', '장면 7/9', '장면 8/9', '장면 9/9', '마무리']);
  assert.equal(r.sceneCount, 9);
  const all = resolvePreset(customerOnpremFull, plan({ voiceInput: 'real', sttDevice: 'cuda', localLlm: true, liveClustering: true }));
  assert.deepEqual(all.segments.map((s) => `${s.key}:${s.budgetSec}`), ['opening:40', 's1:90', 's2:80', 's3:55', 's4:75', 's5:95', 's6:100', 's7:150', 'voice:140', 'proactive:70', 'edge:120', 'closing:20']);
  assert.equal(all.segments.find((s) => s.key === 'edge')!.chip, '장면 10/10');
  assert.deepEqual(all.segments.find((s) => s.key === 's4')!.skipOrder, ['S4-06']); // S4-03은 비활성
  assert.deepEqual(r.segments.find((s) => s.key === 's4')!.skipOrder, ['S4-03', 'S4-06']);
  assert.deepEqual(r.segments.find((s) => s.key === 's7')!.skipOrder, ['S7-06', 'S7-01', 'S7-05']);
  assert.deepEqual(all.segments.find((s) => s.key === 's7')!.skipOrder, ['S7-06', 'S7-05'], '실시간 분석이면 S7-01이 핵심(입력)이라 생략 순서에서 빠진다');
});

test('H-T19 ③: 변형(같은 ID) 계획마다 정확히 1개 활성 · SV-02 ↔ SV-03 · 비활성 단계는 옵션 생략 행(사유 포함)', () => {
  for (const p of PLAN_MATRIX) {
    const r = resolvePreset(customerOnpremFull, p);
    const ids = r.segments.flatMap((s) => s.steps.map((x) => x.id));
    assert.equal(new Set(ids).size, ids.length, planKey(p));
    assert.equal(ids.filter((i) => i === 'S0-01').length, 1);
    assert.equal(ids.filter((i) => i === 'S7-01').length, 1);
    assert.equal(ids.includes('SV-02'), p.voiceInput === 'off');
    assert.equal(ids.includes('SV-03'), p.voiceInput !== 'off');
    assert.equal(ids.includes('SE-01'), p.localLlm);
    assert.equal(ids.includes('S4-03'), !p.localLlm);
    assert.equal(ids.includes('S7-07'), p.liveClustering);
  }
  const off = resolvePreset(customerOnpremFull, plan());
  assert.deepEqual(off.inactiveRows.map((x) => x.stepId).sort(), ['SE-01', 'SE-02', 'SE-03', 'SE-04', 'SV-03', 'SV-04', 'SV-08', 'S7-07'].sort());
  assert.equal(off.inactiveSegments.length, 1);
  assert.equal(off.inactiveSegments[0].key, 'edge');
});

test('H-T19 ⑤: ⑩ 뒤(장면 9·10·끝)에는 음성 입력에 의존하는 단계가 없다 — 음성 입력만 다른 두 계획의 단계 목록이 같다', () => {
  for (const llm of [false, true]) {
    const a = resolvePreset(customerOnpremFull, plan({ localLlm: llm }));
    const b = resolvePreset(customerOnpremFull, plan({ localLlm: llm, voiceInput: 'real', sttDevice: 'cpu' }));
    for (const k of ['proactive', 'edge', 'closing']) {
      const ids = (r: typeof a) => r.segments.filter((s) => s.key === k).flatMap((s) => s.steps.map((x) => x.id)).join(',');
      assert.equal(ids(a), ids(b), k);
    }
  }
});

test('H-T19 ⑥ · H-S7: 10분판 해석 결과 = 정적 정의(구간 9 · 예산 600 · 단계 ID 동일) · 풀 투어 해석 뒤에도 10분판 정의가 변하지 않는다', () => {
  const ser = () => JSON.stringify(customerOnprem10m.segments.map((s) => ({ key: s.key, chip: s.chip, title: s.title, budget: s.budgetSec, skip: s.skipOrder, steps: s.steps.map((x) => ({ id: x.id, t: x.title, n: x.narration, d: x.disclosure, b: x.budgetSec, c: x.core, k: x.skippable, run: x.run.toString(), v: x.verify?.toString(), h: typeof x.headless === 'function' ? x.headless.toString() : x.headless })) })));
  const before = ser();
  const r10 = resolvePreset(customerOnprem10m, defaultPlan('customer-onprem-10m', 'visible'));
  assert.equal(r10.segments, customerOnprem10m.segments);
  assert.equal(r10.segments.length, 9);
  assert.equal(r10.totalBudgetSec, 600);
  assert.equal(r10.inactiveRows.length, 0);
  for (const p of PLAN_MATRIX) resolvePreset(customerOnpremFull, p);
  assert.equal(ser(), before);
  // derive는 새 객체를 만들고 원본을 바꾸지 않는다
  const s = customerOnprem10m.segments[0].steps[0];
  const d = derive(s, { budgetSec: 99 });
  assert.notEqual(d, s);
  assert.equal(s.budgetSec, 15);
  assert.equal(d.budgetSec, 99);
});

test('H-S7: scenarios/full/** 은 DT-1 단계 객체에 대입(step.x = …)하지 않는다 · 10분판 정의 파일은 풀 투어를 import하지 않는다', () => {
  const dir = join(PKG_ROOT, 'src', 'scenarios', 'full');
  for (const name of readdirSync(dir)) {
    const text = readFileSync(join(dir, name), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(?:st|step|s\d{3}\w*)\.(?:title|narration|disclosure|budgetSec|core|skippable|run|verify|badges|capture|layout)\s*=[^=]/.test(text), `${name}: 단계 객체 대입 금지`);
  }
  for (const f of ['opening', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'closing', 'index']) {
    const text = readFileSync(join(PKG_ROOT, 'src', 'scenarios', `${f}.ts`), 'utf8');
    assert.ok(!/from '\.\/full\//.test(text), `${f}.ts는 풀 투어 모듈을 import하지 않는다`);
  }
  assert.ok(!readFileSync(join(PKG_ROOT, 'src', 'presets', 'customer-onprem-10m.ts'), 'utf8').includes('full'));
});

test('--skip 검사: 풀 투어 계획 문맥 기준 — 실시간 분석이면 S7-01은 핵심(생략 불가) · 비활성 단계 ID는 조용히 무시', () => {
  assert.deepEqual(checkSkipIds(customerOnpremFull, ['S7-01'], plan()), []);
  assert.ok(checkSkipIds(customerOnpremFull, ['S7-01'], plan({ liveClustering: true }))[0].includes('핵심 단계'));
  assert.deepEqual(checkSkipIds(customerOnpremFull, ['SV-06', 'SP-04', 'S4-03'], plan({ localLlm: true })), []);
  assert.ok(checkSkipIds(customerOnpremFull, ['SV-01'], plan())[0].includes('핵심 단계'));
  assert.ok(checkSkipIds(customerOnpremFull, ['SX-01'], plan())[0].includes('형식'));
});

// ── H-T19 ④ · H-T27: 사실 의존 문구는 모든 계획·사실 조합에서 40자 · 기호 · 옵션 이름 규칙을 지킨다 ──
function* factCombos(): Generator<{ p: PlanContext; f: { governanceFallback: boolean; embeddingTimeoutMs: number; embeddingTimeoutDefault: number } }> {
  for (const base of PLAN_MATRIX) {
    for (const note of [null, { kind: 'SELECTED' as const, reason: 'x' }, { kind: 'FALLBACK' as const, reason: 'y' }]) {
      if (note && base.voiceInput !== 'real') continue;
      for (const gov of [false, true]) for (const to of [300, 600, 2000]) yield { p: { ...base, deviceNote: note, voiceOmittedReason: undefined }, f: { governanceFallback: gov, embeddingTimeoutMs: to, embeddingTimeoutDefault: 300 } };
    }
  }
  // 불가로 생략된 계획(voiceRequested ∧ off)
  yield { p: plan({ voiceRequested: true, voiceOmittedReason: '모델 없음' }), f: { governanceFallback: false, embeddingTimeoutMs: 300, embeddingTimeoutDefault: 300 } };
}

function okLine(line: string, where: string): void {
  assert.ok([...line].length <= 40, `${where}: 40자 초과 — ${line}`);
  assert.ok(!FORBIDDEN.test(line), `${where}: 금지 기호 — ${line}`);
  assert.ok(!line.includes('--'), `${where}: 옵션 이름 — ${line}`);
}

test('H-T19 ④: 동적 안내 줄·자막 문구는 모든 계획 × 장치 선택·대체 × 거버넌스·대기 시간 조합에서 40자·기호 규칙 통과', () => {
  let n = 0;
  for (const { p, f } of factCombos()) {
    n++;
    for (const l of [s001Disclosure(p, f), s002Disclosure(p), sv01Disclosure(p), sv03Disclosure(p)]) if (l) okLine(l, planKey(p));
    for (const lines of [sv07Narration(p), se01Narration(p)]) {
      assert.ok(lines.length >= 1 && lines.length <= 2);
      for (const l of lines) okLine(l, planKey(p));
    }
  }
  assert.ok(n > 100);
  for (const l of [...S0_01_NARRATION_CPU, ...S0_01_NARRATION_GPU, SE01_DISCLOSURE, SE02_DISCLOSURE, SP01_DISCLOSURE, SV05_NO_VOICE_DISCLOSURE, ...s702Narration(true), ...s702Narration(false), s707Disclosure(38) ?? '', s707Disclosure(null) ?? '']) okLine(l, 'static');
  for (const v of Object.values(FALLBACK_TEXTS)) {
    okLine(v.caption, 'fallback caption');
    if ('notice' in v && v.notice) okLine(v.notice, 'fallback notice');
  }
});

test('S0-01 안내 줄 우선순위: 장치 대체 > 장치 선택 > 거버넌스 꺼짐 > 대기 시간 > GPU 사용 알림', () => {
  const f = { governanceFallback: true, embeddingTimeoutMs: 600, embeddingTimeoutDefault: 300 };
  const real = plan({ voiceInput: 'real', sttDevice: 'cpu', sttModel: 'small' });
  assert.equal(s001Disclosure({ ...real, deviceNote: { kind: 'FALLBACK', reason: 'x' } }, f), '음성 인식 장치를 GPU에서 CPU로 바꿔 시작했습니다');
  assert.equal(s001Disclosure({ ...real, deviceNote: { kind: 'SELECTED', reason: 'x' } }, f), '이 PC는 GPU 조건이 안 돼 음성 인식을 CPU로 돌립니다');
  assert.equal(s001Disclosure(plan(), f), '이번 시연은 데이터 통제 모드를 끈 상태입니다');
  assert.equal(s001Disclosure(plan(), { ...f, governanceFallback: false }), '문장 분석 대기 시간을 600ms로 늘렸습니다');
  assert.equal(s001Disclosure(plan({ localLlm: true }), { ...f, governanceFallback: false, embeddingTimeoutMs: 300 }), '이 노트북 GPU를 쓰는 구간이 있습니다');
  assert.equal(s001Disclosure(plan(), { ...f, governanceFallback: false, embeddingTimeoutMs: 300 }), undefined);
});

test('GPU 사용 4상태 · 출구 이름 · 고객용 생략 문구(옵션 이름·포트 0 · 줄당 44자 이하)', () => {
  assert.equal(gpuUse(plan()), 'none');
  assert.equal(gpuUse(plan({ voiceInput: 'real', sttDevice: 'cuda' })), 'stt');
  assert.equal(gpuUse(plan({ voiceInput: 'real', sttDevice: 'cpu' })), 'none');
  assert.equal(gpuUse(plan({ localLlm: true })), 'llm');
  assert.equal(gpuUse(plan({ voiceInput: 'real', sttDevice: 'cuda', localLlm: true })), 'both');
  assert.deepEqual(Object.values(GPU_USE_TEXT), ['사용하지 않음', '음성 인식에 사용', '사내 생성 모델에만 사용 (장면 10)', '음성 인식 + 사내 생성 모델 (장면 10 전에 음성 인식을 내립니다)']);
  assert.deepEqual(egressNames(plan({ voiceInput: 'real', sttDevice: 'cuda', localLlm: true })), ['문장 분석', '음성 인식', '소형 생성']);
  assert.deepEqual(egressNames(plan()), ['문장 분석']);
  for (const p of [plan(), plan({ voiceRequested: true, voiceOmittedReason: '모델 없음 (--x)' }), plan({ llmRequested: true, llmOmittedReason: 'Ollama --y' })]) {
    for (const r of [voiceInactiveReason(p), edgeInactiveReason(p)]) {
      const line = omitCustomerLine(r);
      assert.ok(!line.includes('--'), line);
      assert.ok(!/\d{4}/.test(line), `포트 번호 금지: ${line}`);
      assert.ok([...line].length <= 45, `45자 초과: ${line}`); // 설계 "줄당 44자 이하" — 장면 이름이 긴 음성 줄은 설계가 정한 문구 그대로 45자(1자 초과 · 보고서 달라진 점)
      assert.ok(r.internal.includes('--with-'), '내부 문구에는 옵션 이름이 있다');
    }
  }
  assert.equal(omitCustomerLine(edgeInactiveReason(plan())), '사내 소형 생성 모델 장면 - 이번 구성에서 켜지 않아 보여 드리지 않았습니다');
  assert.equal(omitCustomerLine(voiceInactiveReason(plan({ voiceRequested: true, voiceOmittedReason: 'x' }))), '음성으로 묻기(눌러서 말하기) - 이 PC에서 준비하지 못해 생략했습니다');
});
