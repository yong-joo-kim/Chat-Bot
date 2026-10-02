// 시나리오 정의(설계 §10 · §11.1) — 9구간 단계표가 설계와 같다 · 배지 증거 조건(ui-spec §4.4) · 정적 규칙(data-testid 0 · 선택자 단일 출처)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BADGE_LABELS, badgeEvidence, MAX_BADGES, resolveBadges } from '../src/scenario/badges';
import { checkPresetDefinition, readingTimeSec } from '../src/scenario/definition-check';
import { BADGE_KEYS, type RunFacts, type StepDef } from '../src/scenario/types';
import { customerOnprem10m } from '../src/presets/customer-onprem-10m';

const PKG_ROOT = join(__dirname, '..', '..');

/** 설계 §10 단계표: 단계 ID -> [예산, 핵심 여부]. */
const DESIGN: Record<string, Array<[string, number, boolean]>> = {
  opening: [['S0-01', 15, true], ['S0-02', 15, false]],
  s1: [['S1-01', 10, false], ['S1-02', 10, false], ['S1-03', 15, true], ['S1-04', 15, true], ['S1-05', 15, true], ['S1-06', 15, false], ['S1-07', 10, false]],
  s2: [['S2-01', 10, true], ['S2-02', 10, true], ['S2-03', 12, true], ['S2-04', 12, true], ['S2-05', 12, false], ['S2-06', 14, true], ['S2-07', 10, false]],
  s3: [['S3-01', 5, true], ['S3-02', 20, true], ['S3-03', 15, true], ['S3-04', 15, false]],
  s4: [['S4-01', 15, true], ['S4-02', 20, true], ['S4-03', 20, false], ['S4-04', 15, true], ['S4-05', 15, true], ['S4-06', 10, false]],
  s5: [['S5-01', 10, true], ['S5-02', 15, true], ['S5-03', 20, true], ['S5-04', 12, true], ['S5-05', 15, true], ['S5-06', 10, true], ['S5-07', 13, false]],
  s6: [['S6-01', 12, true], ['S6-02', 15, true], ['S6-03', 12, true], ['S6-04', 10, false], ['S6-05', 11, false], ['S6-06', 10, false]],
  s7: [['S7-01', 15, false], ['S7-02', 15, true], ['S7-03', 15, true], ['S7-04', 15, true], ['S7-05', 10, false]],
  closing: [['S9-01', 12, true], ['S9-02', 3, false]],
};

const FACTS: RunFacts = { device: 'cpu', gpuHidden: true, governance: 'ON', externalAddresses: 0, embeddingTimeoutMs: 300, embeddingTimeoutDefault: 300, governanceFallback: false };

test('9구간 모두 단계 정의가 있고 정의 검사를 통과한다(빈 슬롯 0)', () => {
  assert.deepEqual(checkPresetDefinition(customerOnprem10m), []);
  for (const seg of customerOnprem10m.segments) assert.ok(seg.steps.length > 0, `${seg.key} 단계 없음`);
});

test('단계 ID · 예산 · 핵심 표식이 설계 §10 표와 같다', () => {
  for (const seg of customerOnprem10m.segments) {
    const want = DESIGN[seg.key];
    assert.deepEqual(seg.steps.map((s) => [s.id, s.budgetSec, s.core]), want, seg.key);
  }
});

test('핵심 단계 합(설계 §11.1): 시작 15 · ① 45 · ② 58 · ③ 40 · ④ 65 · ⑤ 82 · ⑥ 39 · ⑦ 45 · 끝 12 = 401초', () => {
  const core = Object.fromEntries(customerOnprem10m.segments.map((s) => [s.key, s.steps.filter((x) => x.core).reduce((n, x) => n + x.budgetSec, 0)]));
  assert.deepEqual(core, { opening: 15, s1: 45, s2: 58, s3: 40, s4: 65, s5: 82, s6: 39, s7: 45, closing: 12 });
  assert.equal(Object.values(core).reduce((a, b) => a + b, 0), 401);
});

test('구간 생략 순서가 설계 §11.1과 같다', () => {
  const skip = Object.fromEntries(customerOnprem10m.segments.map((s) => [s.key, s.skipOrder.join(',')]));
  assert.deepEqual(skip, { opening: 'S0-02', s1: 'S1-06,S1-07,S1-02,S1-01', s2: 'S2-05,S2-07', s3: 'S3-04', s4: 'S4-03,S4-06', s5: 'S5-07', s6: 'S6-06,S6-04,S6-05', s7: 'S7-01,S7-05', closing: 'S9-02' });
});

test('구간 대표 캡처 9장과 핵심 캡처 17장이 모두 캡처 지시(screenshot/gif-clip)를 가진 핵심 단계다(AC-DH4-1)', () => {
  const byId = new Map<string, StepDef>();
  for (const seg of customerOnprem10m.segments) for (const s of seg.steps) byId.set(s.id, s);
  const core17 = ['S0-01', 'S1-03', 'S1-05', 'S2-03', 'S2-06', 'S3-02', 'S3-03', 'S4-01', 'S4-05', 'S5-03', 'S5-04', 'S5-06', 'S6-02', 'S6-03', 'S7-02', 'S7-04', 'S9-01'];
  for (const id of core17) {
    const s = byId.get(id)!;
    assert.ok(s.core && s.capture !== 'none', id);
  }
});

test('GIF 4개: S1-05 · S2-06 · S5-04 · S7-02 만 gif-clip(설계 §15)', () => {
  const clips = customerOnprem10m.segments.flatMap((s) => s.steps).filter((s) => s.capture === 'gif-clip').map((s) => s.id);
  assert.deepEqual(clips.sort(), ['S1-05', 'S2-06', 'S5-04', 'S7-02']);
});

test('S6-05는 시작 장면의 데이터 지도(S0-02)를 생략하면 핵심으로 승격된다(설계 §10.7)', () => {
  const s65 = customerOnprem10m.segments.flatMap((s) => s.steps).find((s) => s.id === 'S6-05')!;
  assert.equal(s65.promoteIfSkipped, 'S0-02');
  assert.equal(s65.skippable, true);
});

test('API 단계(S3-01 · S9-02)는 자막을 새로 내지 않는 단계이고 S3-01은 핵심 검증 단계다', () => {
  const steps = customerOnprem10m.segments.flatMap((s) => s.steps);
  assert.equal(steps.find((s) => s.id === 'S3-01')!.driver, 'API');
  assert.equal(steps.find((s) => s.id === 'S9-02')!.driver, 'API');
});

test('S5-07 · 대체 장면: 예약 기록 화면 자막과 안내 줄이 설계와 같다(FR-DH9-2)', () => {
  const s = customerOnprem10m.segments.flatMap((x) => x.steps).find((x) => x.id === 'S5-07')!;
  assert.equal(s.fallback?.caption, '예약 기록 화면입니다');
  assert.equal(s.fallback?.notice, '준비 단계에서 같은 방식으로 실행된 기록입니다');
  assert.equal(s.disclosure, '예약과 두 번째 관리자의 사전 승인은 시작 때 미리 처리했습니다');
});

test('S9-01 자막은 "오늘 보여 드리지 않는 기능"(No.32가 구현돼 "아직 보여 드릴 수 없는"은 사실과 다르다 — FR-DX0-1)', () => {
  const s = customerOnprem10m.segments.flatMap((x) => x.steps).find((x) => x.id === 'S9-01')!;
  assert.ok(s.narration.join(' ').includes('오늘 보여 드리지 않는 기능'));
  assert.ok(!s.narration.join(' ').includes('아직 보여 드릴 수 없'));
  assert.equal(s.disclosure, '출시 일정은 약속하지 않습니다');
});

test('모든 단계의 자막 읽기 시간은 예산 - 1초 이하(ui-spec §4.3)', () => {
  for (const s of customerOnprem10m.segments.flatMap((x) => x.steps)) assert.ok(readingTimeSec(s) <= s.budgetSec - 1, s.id);
});

// ── 배지 증거 조건 ──
test('배지 8종의 글자는 ui-spec §4.4와 같다', () => {
  assert.deepEqual(Object.values(BADGE_LABELS).sort(), ['CPU 동작', '감사 기록', '보존·파기', '사내 보관', '사내 설치', '사람 승인', '외부 송신 없음', '출구 통제'].sort());
  assert.equal(BADGE_KEYS.length, 8);
});

test('CPU 동작: 장치가 cpu 이고 GPU를 노출하지 않았을 때만', () => {
  assert.equal(badgeEvidence('CPU_ONLY', FACTS, false), true);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, device: 'cuda' }, false), false);
  assert.equal(badgeEvidence('CPU_ONLY', { ...FACTS, gpuHidden: false }, false), false);
});

test('외부 송신 없음 · 출구 통제: 서버 출구 키가 0개일 때 · 거버넌스 ON일 때만', () => {
  assert.equal(badgeEvidence('NO_EXTERNAL_SEND', FACTS, false), true);
  assert.equal(badgeEvidence('NO_EXTERNAL_SEND', { ...FACTS, externalAddresses: 1 }, false), false);
  assert.equal(badgeEvidence('EGRESS_GATE', FACTS, false), true);
  assert.equal(badgeEvidence('EGRESS_GATE', { ...FACTS, governance: 'OFF' }, false), false);
});

test('장면이 증명하는 배지(사람 승인 · 감사 기록 · 사내 보관 · 보존)는 검증을 통과했을 때만', () => {
  for (const k of ['HUMAN_APPROVAL', 'AUDIT_TRAIL', 'ONPREM_STORAGE', 'RETENTION'] as const) {
    assert.equal(badgeEvidence(k, FACTS, false), false, k);
    assert.equal(badgeEvidence(k, FACTS, true), true, k);
  }
  assert.deepEqual(resolveBadges(['HUMAN_APPROVAL', 'AUDIT_TRAIL'], FACTS, false), []);
  assert.deepEqual(resolveBadges(['HUMAN_APPROVAL', 'AUDIT_TRAIL'], FACTS, true), ['사람 승인', '감사 기록']);
});

test('자막 띠 배지는 단계당 최대 2개 — 단계 정의도 2개를 넘지 않는다', () => {
  assert.equal(MAX_BADGES, 2);
  assert.equal(resolveBadges(['ONPREM_INSTALL', 'CPU_ONLY', 'NO_EXTERNAL_SEND'], FACTS, true).length, 2);
  for (const s of customerOnprem10m.segments.flatMap((x) => x.steps)) assert.ok((s.badges?.length ?? 0) <= MAX_BADGES, s.id);
});

// ── 정적 규칙 ──
function walk(dir: string, ext: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(PKG_ROOT, p).split(sep).join('/');

test('data-testid 추가 0: 하네스 소스·템플릿이 data-testid를 쓰지 않는다(DHD-14)', () => {
  const files = [...walk(join(PKG_ROOT, 'src'), ['.ts', '.cjs']), ...walk(join(PKG_ROOT, 'assets'), ['.html', '.js', '.css'])];
  // 주석 속 설명("data-testid 0")은 사용이 아니다 — 주석을 걷어 낸 코드·템플릿만 본다
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  const bad = files.filter((f) => /data-testid|getByTestId/.test(strip(readFileSync(f, 'utf8')))).map(rel);
  assert.deepEqual(bad, []);
});

test('H-S5: 접근성 이름 선택자 문구는 src/selectors 에만 있고 시나리오는 선택자 모듈을 쓴다(CSS 구조 선택자 최소화)', () => {
  // 시나리오 파일의 `locator('...')`는 위젯 말풍선 클래스(.cb-msg-*)·본문(body)·표 행 몇 가지로 한정한다(문구 ancestor 탐색 1곳 포함)
  const allowed = [/^\.cb-msg-/, /^body$/, /^xpath=ancestor::/];
  const bad: string[] = [];
  for (const f of walk(join(PKG_ROOT, 'src', 'scenarios'), ['.ts'])) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.locator\(\s*['"`]([^'"`]+)['"`]/g)) {
      if (!allowed.some((re) => re.test(m[1]))) bad.push(`${rel(f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});
