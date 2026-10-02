// H-T2: 프리셋 정의 검사(설계 §9.1 · ui-spec A-1·A-4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPresetDefinition, checkSkipIds, readingTimeSec } from '../src/scenario/definition-check';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';
import { getPreset, listPresetIds } from '../src/presets';
import type { PresetDef, SegmentDef, StepDef } from '../src/scenario/types';

const noop = async () => undefined;

function step(over: Partial<StepDef> & Pick<StepDef, 'id'>): StepDef {
  return {
    title: '단계',
    narration: ['짧은 자막'],
    budgetSec: 10,
    driver: 'UI',
    layout: 'console',
    core: true,
    skippable: false,
    capture: 'none',
    run: noop,
    ...over,
  };
}

function preset(segments: SegmentDef[], total: number): PresetDef {
  return { id: 'x', audience: 'ONPREM', totalBudgetSec: total, segments, modesAllowed: ['visible'] };
}

/** 9개 구간을 모두 채운 합성 프리셋(구간당 단계 1개) — 규칙 위반 케이스의 기반. */
function fullPreset(mutate?: (segs: SegmentDef[]) => void): PresetDef {
  const base = customerOnprem10m.segments.map((s) => ({
    ...s,
    slot: false,
    skipOrder: [] as string[],
    steps: [step({ id: `S${s.key === 'opening' ? 0 : s.key === 'closing' ? 9 : s.key.slice(1)}-01` as StepDef['id'], budgetSec: s.budgetSec, narration: ['짧게'] })],
  }));
  mutate?.(base);
  return preset(base, 600);
}

test('기본 프리셋: 9구간 · 총 600초 · 구간 예산 합 일치 · 정의 오류 0', () => {
  assert.equal(customerOnprem10m.segments.length, 9);
  assert.equal(customerOnprem10m.totalBudgetSec, 600);
  assert.equal(customerOnprem10m.segments.reduce((n, s) => n + s.budgetSec, 0), 600);
  assert.deepEqual(checkPresetDefinition(customerOnprem10m), []);
});

test('구간 키 순서와 예산이 설계 §11.1과 같다', () => {
  assert.deepEqual(customerOnprem10m.segments.map((s) => `${s.key}:${s.budgetSec}`), [
    'opening:30', 's1:90', 's2:80', 's3:55', 's4:95', 's5:95', 's6:70', 's7:70', 'closing:15',
  ]);
});

test('구간 제목·칩은 ui-spec §3.5 문구', () => {
  const t = Object.fromEntries(customerOnprem10m.segments.map((s) => [s.key, `${s.chip}|${s.title}`]));
  assert.equal(t.opening, '시작|구축형 구성 확인');
  assert.equal(t.s5, '장면 5/7|버전과 배포 통제');
  assert.equal(t.closing, '마무리|마무리와 로드맵');
});

test('생략 순서는 설계 §11.1 표와 같고 핵심 단계 ID를 담지 않는다', () => {
  const skip = Object.fromEntries(customerOnprem10m.segments.map((s) => [s.key, s.skipOrder.join(',')]));
  assert.equal(skip.s1, 'S1-06,S1-07,S1-02,S1-01');
  assert.equal(skip.s6, 'S6-06,S6-04,S6-05');
  assert.equal(skip.closing, 'S9-02');
});

test('프리셋 레지스트리', () => {
  assert.deepEqual(listPresetIds(), ['customer-onprem-10m', 'customer-onprem-full']);
  assert.ok(getPreset('customer-onprem-10m'));
  assert.equal(getPreset('nope'), undefined);
});

test('합성 프리셋(모든 구간에 단계 1개)은 통과한다', () => {
  assert.deepEqual(checkPresetDefinition(fullPreset()), []);
});

test('총 예산 불일치를 잡는다', () => {
  const p = fullPreset();
  p.totalBudgetSec = 590;
  assert.ok(checkPresetDefinition(p).some((i) => i.message.includes('총 예산')));
});

test('단계 예산 합 ≠ 구간 예산을 잡는다', () => {
  const p = fullPreset((segs) => {
    segs[1].steps[0].budgetSec = 80;
  });
  assert.ok(checkPresetDefinition(p).some((i) => i.where === 'segment s1' && i.message.includes('단계 예산 합')));
});

test('core && skippable 동시 true 금지, 둘 다 false도 금지', () => {
  const both = fullPreset((segs) => {
    segs[2].steps[0].core = true;
    segs[2].steps[0].skippable = true;
  });
  assert.ok(checkPresetDefinition(both).some((i) => i.message.includes('동시에 true')));
  const neither = fullPreset((segs) => {
    segs[2].steps[0].core = false;
    segs[2].steps[0].skippable = false;
  });
  assert.ok(checkPresetDefinition(neither).some((i) => i.message.includes('core 또는 skippable 중 하나')));
});

test('skipOrder 는 그 구간의 생략 가능 단계만', () => {
  const p = fullPreset((segs) => {
    segs[1].skipOrder = ['S1-01']; // 핵심 단계
  });
  assert.ok(checkPresetDefinition(p).some((i) => i.message.includes('생략 가능 단계가 아닙니다')));
  const q = fullPreset((segs) => {
    segs[1].skipOrder = ['S1-99'];
  });
  assert.ok(checkPresetDefinition(q).some((i) => i.message.includes('이 구간의 단계가 아닙니다')));
});

test('단계 ID 유일 · 구간 번호 접두 일치', () => {
  const dup = fullPreset((segs) => {
    segs[2].steps[0].id = 'S1-01';
  });
  const issues = checkPresetDefinition(dup);
  assert.ok(issues.some((i) => i.message.includes('중복')));
  assert.ok(issues.some((i) => i.message.includes('S2-로 시작')));
});

test('자막: 줄당 40자 · 본문 최대 2줄 · 안내 줄 40자(ui-spec A-1·A-4)', () => {
  const long = '가'.repeat(41);
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].narration = [long]; })).some((i) => i.message.includes('40자')));
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].narration = ['a', 'b', 'c']; })).some((i) => i.message.includes('1~2줄')));
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].disclosure = long; })).some((i) => i.message.includes('안내 줄')));
  assert.deepEqual(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].narration = ['가'.repeat(40), '나'.repeat(40)]; s[1].steps[0].budgetSec = 90; })), []);
});

test('자막·제목에 원문자·화살표·체크 기호를 쓰면 오류(ui-spec A-9)', () => {
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].narration = ['① 첫 장면']; })).some((i) => i.message.includes('원문자')));
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].title = '배송 → 환불'; })).some((i) => i.message.includes('제목')));
  assert.ok(checkPresetDefinition(fullPreset((s) => { s[1].steps[0].disclosure = '✓ 확인'; })).some((i) => i.message.includes('안내 줄')));
});

test('읽기 시간 R = max(2초, 글자 수 × 0.12초) 이 단계 예산-1 이하', () => {
  assert.equal(readingTimeSec({ narration: ['가'] }), 2);
  assert.ok(Math.abs(readingTimeSec({ narration: ['가'.repeat(40), '나'.repeat(40)] }) - 9.6) < 1e-9);
  assert.ok(Math.abs(readingTimeSec({ narration: ['가'.repeat(40)], disclosure: '나'.repeat(40) }) - 9.6) < 1e-9);
  const tight = fullPreset((s) => {
    s[8].steps[0].narration = ['가'.repeat(40), '나'.repeat(40)]; // 9.6초 필요, 예산 15 → 통과
    s[0].steps[0].narration = ['가'.repeat(40), '나'.repeat(40)]; // 예산 30 → 통과
  });
  assert.deepEqual(checkPresetDefinition(tight), []);
  const tooLong = fullPreset((s) => {
    s[8].steps[0].budgetSec = 15;
    s[8].steps[0].narration = ['가'.repeat(40), '나'.repeat(40)];
    s[8].steps[0].disclosure = '다'.repeat(40); // 14.4초 > 14
  });
  assert.ok(checkPresetDefinition(tooLong).some((i) => i.message.includes('읽기 시간')));
});

test('--skip 검사: 형식 · (정의가 있으면) 존재·핵심 여부', () => {
  assert.deepEqual(checkSkipIds(customerOnprem10m, ['S1-06']), []); // 1단계: 단계 정의가 없어 형식만
  assert.equal(checkSkipIds(customerOnprem10m, ['S1-6']).length, 1);
  const p = fullPreset((s) => {
    s[1].steps[0].core = false;
    s[1].steps[0].skippable = true;
  });
  assert.deepEqual(checkSkipIds(p, ['S1-01']), []);
  assert.ok(checkSkipIds(p, ['S2-01'])[0].includes('핵심 단계'));
  assert.ok(checkSkipIds(p, ['S4-77'])[0].includes('없는 단계'));
});
