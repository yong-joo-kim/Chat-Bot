// 프리셋·시나리오 정의 검사(설계 §9.1 · ui-spec §12·§13 A-1·A-4) — 하네스 단위 시험 H-T2가 호출하고,
// 실행 시작 시에도 한 번 호출해 정의 오류를 공연 전에 잡는다.
import { ALL_SEGMENT_KEYS, SEGMENT_KEYS, SEGMENT_NUMBER, STEP_ID_RE, type PresetDef, type StepDef } from './types';
import { PLAN_MATRIX, planKey, resolvePreset, type PlanContext } from './plan';

/** ui-spec A-1: 본문 줄당 40자(문자 수) · 본문 최대 2줄 · 안내 줄 40자. */
export const CAPTION_MAX_LINE_CHARS = 40;
export const CAPTION_MAX_BODY_LINES = 2;
/** ui-spec §4.3: 읽기 시간 R = max(2.0초, 글자 수 x 0.12초). */
export function readingTimeSec(step: Pick<StepDef, 'narration' | 'disclosure'>): number {
  const chars = [...step.narration, ...(step.disclosure ? [step.disclosure] : [])].reduce(
    (n, line) => n + [...line].length,
    0,
  );
  return Math.max(2.0, chars * 0.12);
}

/** 원문자·화살표·체크 기호·이모지(ui-spec A-9) — 화면·터미널·보고서에 쓰지 않는다. */
const FORBIDDEN_SYMBOLS_RE = /[①-⓿←-⇿✓✗✔✘ⓘ\u{1f300}-\u{1faff}]/u;

export interface DefinitionIssue {
  where: string;
  message: string;
}


type Adder = (where: string, message: string) => void;

/** 단계 하나의 공통 규칙(ID 접두 · core xor skippable · 자막 줄·기호 · 읽기 시간 · 예산). 10분판과 풀 투어가 같은 규칙을 쓴다. */
function checkStepRules(step: StepDef, segNo: number | string, add: Adder): void {
  const w = `step ${step.id}`;
  const m = /^S([0-9VPE])-(.+)$/.exec(step.id);
  if (!m || m[1] !== String(segNo)) add(w, `단계 ID는 구간 번호 S${segNo}-로 시작해야 합니다`);
  if (step.core && step.skippable) add(w, 'core와 skippable을 동시에 true로 둘 수 없습니다');
  if (!step.core && !step.skippable) add(w, 'core 또는 skippable 중 하나는 true여야 합니다');
  if (step.narration.length < 1 || step.narration.length > CAPTION_MAX_BODY_LINES) {
    add(w, `자막 본문은 1~${CAPTION_MAX_BODY_LINES}줄이어야 합니다`);
  }
  for (const line of step.narration) {
    if ([...line].length > CAPTION_MAX_LINE_CHARS) add(w, `자막 줄이 ${CAPTION_MAX_LINE_CHARS}자를 넘습니다: ${line}`);
    if (FORBIDDEN_SYMBOLS_RE.test(line)) add(w, `자막에 원문자·화살표·기호를 쓸 수 없습니다: ${line}`);
  }
  if (step.disclosure) {
    if ([...step.disclosure].length > CAPTION_MAX_LINE_CHARS) add(w, `안내 줄이 ${CAPTION_MAX_LINE_CHARS}자를 넘습니다`);
    if (FORBIDDEN_SYMBOLS_RE.test(step.disclosure)) add(w, '안내 줄에 원문자·화살표·기호를 쓸 수 없습니다');
  }
  if (FORBIDDEN_SYMBOLS_RE.test(step.title)) add(w, '단계 제목에 원문자·화살표·기호를 쓸 수 없습니다');
  if (readingTimeSec(step) > step.budgetSec - 1) {
    add(w, `읽기 시간(${readingTimeSec(step).toFixed(1)}초)이 단계 예산-1(${step.budgetSec - 1}초)을 넘습니다`);
  }
  if (step.budgetSec <= 0) add(w, '단계 예산은 양수여야 합니다');
}

/** 조건부 프리셋(풀 투어)인지 — `when`이 있거나 `autoChips`이면 대표 계획 16개로 검사한다. */
export function isConditionalPreset(preset: PresetDef): boolean {
  return preset.autoChips === true || preset.segments.some((s) => s.when !== undefined || s.steps.some((st) => st.when !== undefined));
}

/** 필수 선언 대표 계획 — 기본(플래그 없음)과 전부(음성 real·생성·실시간 분석). */
export const REQUIRED_TOTAL_KEYS = ['v:off|l:0|c:0', 'v:real|l:1|c:1'] as const;

/** 조건부 프리셋 검사(설계 §3.3): 모든 대표 계획을 해석해 같은 규칙을 적용한다. 같은 위반은 계획이 달라도 한 번만 보고한다. */
function checkConditionalPreset(preset: PresetDef): DefinitionIssue[] {
  const seen = new Set<string>();
  const issues: DefinitionIssue[] = [];
  const addFor = (planLabel: string): Adder => (where, message) => {
    const k = `${where}|${message}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push({ where, message: planLabel ? `${message} [계획 ${planLabel}]` : message });
  };

  // 원본 정의 검사: 변형(같은 ID 여러 정의) · skipOrder 존재/생략 가능
  for (const seg of preset.segments) {
    const byId = new Map<string, StepDef[]>();
    for (const st of seg.steps) byId.set(st.id, [...(byId.get(st.id) ?? []), st]);
    // 옵션 생략 단계는 사유를 반드시 갖는다(L-7) — 비활성 행의 이유 문구가 비면 보고서·로드맵에 빈 사유가 나간다
    for (const st of seg.steps) if (st.inactive === 'option' && !st.inactiveReason) addFor('')(`step ${st.id}`, "inactive:'option' 단계에는 inactiveReason이 필요합니다");
    for (const [id, defs] of byId) {
      if (defs.length > 1 && defs.some((d) => d.inactive !== 'variant')) addFor('')(`step ${id}`, "같은 ID의 정의가 여럿이면 모두 inactive:'variant'여야 합니다");
    }
    for (const id of seg.skipOrder) {
      const defs = byId.get(id);
      if (!defs) addFor('')(`segment ${seg.key}`, `skipOrder의 ${id}는 이 구간의 단계가 아닙니다`);
      else if (!defs.some((d) => d.skippable)) addFor('')(`segment ${seg.key}`, `skipOrder의 ${id}는 생략 가능 단계가 아닙니다`);
    }
  }

  const totals = new Map<string, number>();
  const sigOf = (plan: PlanContext, key: string): string[] => resolvePreset(preset, plan).segments.filter((s) => s.key === key).flatMap((s) => s.steps.map((st) => st.id));
  for (const plan of PLAN_MATRIX) {
    const label = planKey(plan) + (plan.voiceInput === 'real' ? `:${plan.sttDevice}` : '');
    const add = addFor(label);
    const r = resolvePreset(preset, plan);
    const keys = r.segments.map((s) => s.key);
    // 구간 키는 전역 순서의 부분열 · opening 처음 · closing 끝
    let last = -1;
    for (const k of keys) {
      const idx = ALL_SEGMENT_KEYS.indexOf(k);
      if (idx < 0) add('preset', `알 수 없는 구간 키: ${k}`);
      else if (idx <= last) add('preset', `구간 순서가 전역 순서(${ALL_SEGMENT_KEYS.join(' ')})와 다릅니다: ${keys.join(' ')}`);
      last = Math.max(last, idx);
    }
    if (keys[0] !== 'opening') add('preset', '첫 구간은 opening이어야 합니다');
    if (keys[keys.length - 1] !== 'closing') add('preset', '마지막 구간은 closing이어야 합니다');
    // 활성 단계 ID 유일 · 단계 공통 규칙 · 구간 예산 = 활성 단계 합
    const seenIds = new Set<string>();
    for (const seg of r.segments) {
      const segNo = SEGMENT_NUMBER[seg.key];
      const sum = seg.steps.reduce((n, s) => n + s.budgetSec, 0);
      if (sum !== seg.budgetSec) add(`segment ${seg.key}`, `단계 예산 합(${sum}초)이 구간 예산(${seg.budgetSec}초)과 다릅니다`);
      for (const step of seg.steps) {
        if (seenIds.has(step.id)) add(`step ${step.id}`, '활성 단계 ID가 중복입니다(변형은 계획마다 정확히 1개만 활성이어야 합니다)');
        seenIds.add(step.id);
        checkStepRules(step, segNo, add);
      }
      for (const id of seg.skipOrder) {
        const st = seg.steps.find((s) => s.id === id);
        if (st && !st.skippable) add(`segment ${seg.key}`, `skipOrder의 ${id}는 생략 가능 단계가 아닙니다`);
      }
    }
    // 총 예산 선언
    const key = planKey(plan);
    const prior = totals.get(key);
    if (prior !== undefined && prior !== r.totalBudgetSec) add('preset', `같은 대표 계획(${key})의 총 예산이 장치에 따라 달라집니다(${prior} ≠ ${r.totalBudgetSec})`);
    totals.set(key, r.totalBudgetSec);
    const want = preset.expectedTotals?.[key];
    if (want !== undefined && want !== r.totalBudgetSec) add('preset', `대표 계획 ${key}의 해석 총 예산(${r.totalBudgetSec}초)이 선언값(${want}초)과 다릅니다`);
    // voice 이후 구간에 음성 입력 의존 단계 0 — 음성 입력만 다른 두 계획의 활성 단계 목록이 같아야 한다
    if (plan.voiceInput === 'real') {
      const off = { ...plan, voiceInput: 'off' as const, sttDevice: null, sttModel: null };
      for (const k of ['opening', 'proactive', 'edge', 'closing'] as const) {
        if (sigOf(plan, k).join(',') !== sigOf(off, k).join(',')) add(`segment ${k}`, '음성 입력 여부에 따라 이 구간의 단계 목록이 달라집니다(장면 8 뒤에는 음성 장면이 없어야 합니다)');
      }
    }
  }
  for (const k of REQUIRED_TOTAL_KEYS) if (preset.expectedTotals?.[k] === undefined) addFor('')('preset', `대표 계획 ${k}의 총 예산 선언(expectedTotals)이 없습니다`);
  return issues;
}

export function checkPresetDefinition(preset: PresetDef): DefinitionIssue[] {
  if (isConditionalPreset(preset)) return checkConditionalPreset(preset);
  const issues: DefinitionIssue[] = [];
  const add = (where: string, message: string) => issues.push({ where, message });

  // 구간 키 순서·유일
  const keys = preset.segments.map((s) => s.key);
  if (keys.join(',') !== SEGMENT_KEYS.join(',')) {
    add('preset', `구간은 ${SEGMENT_KEYS.join(' ')} 순서로 9개여야 합니다 (실제: ${keys.join(' ')})`);
  }

  const segSum = preset.segments.reduce((n, s) => n + s.budgetSec, 0);
  if (segSum !== preset.totalBudgetSec) {
    add('preset', `구간 예산 합(${segSum}초)이 프리셋 총 예산(${preset.totalBudgetSec}초)과 다릅니다`);
  }

  const seenIds = new Set<string>();
  for (const seg of preset.segments) {
    const segNo = SEGMENT_NUMBER[seg.key];
    const stepSum = seg.steps.reduce((n, s) => n + s.budgetSec, 0);
    if (!(seg.slot && seg.steps.length === 0) && stepSum !== seg.budgetSec) {
      add(`segment ${seg.key}`, `단계 예산 합(${stepSum}초)이 구간 예산(${seg.budgetSec}초)과 다릅니다`);
    }
    const byId = new Map(seg.steps.map((s) => [s.id as string, s]));
    const emptySlot = seg.slot === true && seg.steps.length === 0;
    for (const id of seg.skipOrder) {
      if (emptySlot) {
        if (!id.startsWith(`S${segNo}-`) || !/^S\d-\d{2}$/.test(id)) add(`segment ${seg.key}`, `skipOrder의 ${id}는 구간 번호 S${segNo}-NN 형식이 아닙니다`);
        continue;
      }
      const st = byId.get(id);
      if (!st) add(`segment ${seg.key}`, `skipOrder의 ${id}는 이 구간의 단계가 아닙니다`);
      else if (!st.skippable) add(`segment ${seg.key}`, `skipOrder의 ${id}는 생략 가능 단계가 아닙니다`);
    }
    for (const step of seg.steps) {
      if (seenIds.has(step.id)) add(`step ${step.id}`, '단계 ID가 중복입니다');
      seenIds.add(step.id);
      checkStepRules(step, segNo, add);
    }
  }
  return issues;
}

/**
 * `--skip`에 지정한 단계 ID 검증 — 알 수 없는 ID·핵심 단계는 시작 전 오류(설계 §4.2). 슬롯만 있는 1단계에서는 형식만 확인.
 * [DT-2] 조건부 프리셋은 계획 문맥이 있으면 활성 단계 기준으로 검사한다(변형이 핵심인 계획에서 그 단계를 건너뛰지 못하게). 계획에서 비활성인 단계 ID는 조용히 무시한다.
 */
export function checkSkipIds(preset: PresetDef, skip: string[], plan?: PlanContext): string[] {
  const errors: string[] = [];
  const all = new Map<string, StepDef[]>();
  let anyDefined = false;
  for (const seg of preset.segments) {
    for (const st of seg.steps) {
      all.set(st.id, [...(all.get(st.id) ?? []), st]);
      anyDefined = true;
    }
  }
  const active = plan && isConditionalPreset(preset) ? new Map(resolvePreset(preset, plan).segments.flatMap((sg) => sg.steps).map((st) => [st.id as string, st])) : null;
  for (const id of skip) {
    if (!STEP_ID_RE.test(id)) {
      errors.push(`--skip 값 ${id}은(는) 단계 ID 형식(S3-04)이 아닙니다`);
      continue;
    }
    if (!anyDefined) continue; // 1단계: 단계 정의가 아직 없다
    const defs = all.get(id);
    if (!defs) {
      errors.push(`--skip 값 ${id}은(는) 프리셋 ${preset.id}에 없는 단계입니다`);
      continue;
    }
    if (active) {
      const st = active.get(id);
      if (st?.core) errors.push(`--skip 값 ${id}은(는) 핵심 단계라 생략할 수 없습니다`);
      continue;
    }
    if (defs.every((d) => d.core)) errors.push(`--skip 값 ${id}은(는) 핵심 단계라 생략할 수 없습니다`);
  }
  return errors;
}
