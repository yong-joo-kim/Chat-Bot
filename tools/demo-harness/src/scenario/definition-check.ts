// 프리셋·시나리오 정의 검사(설계 §9.1 · ui-spec §12·§13 A-1·A-4) — 하네스 단위 시험 H-T2가 호출하고,
// 실행 시작 시에도 한 번 호출해 정의 오류를 공연 전에 잡는다.
import { SEGMENT_KEYS, SEGMENT_NUMBER, type PresetDef, type StepDef } from './types';

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

export function checkPresetDefinition(preset: PresetDef): DefinitionIssue[] {
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
      const w = `step ${step.id}`;
      if (seenIds.has(step.id)) add(w, '단계 ID가 중복입니다');
      seenIds.add(step.id);
      const m = /^S(\d)-(.+)$/.exec(step.id);
      if (!m || Number(m[1]) !== segNo) add(w, `단계 ID는 구간 번호 S${segNo}-로 시작해야 합니다`);
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
  }
  return issues;
}

/** `--skip`에 지정한 단계 ID 검증 — 알 수 없는 ID·핵심 단계는 시작 전 오류(설계 §4.2). 슬롯만 있는 1단계에서는 형식만 확인. */
export function checkSkipIds(preset: PresetDef, skip: string[]): string[] {
  const errors: string[] = [];
  const all = new Map<string, StepDef>();
  let anyDefined = false;
  for (const seg of preset.segments) {
    for (const st of seg.steps) {
      all.set(st.id, st);
      anyDefined = true;
    }
  }
  for (const id of skip) {
    if (!/^S\d-\d{2}$/.test(id)) {
      errors.push(`--skip 값 ${id}은(는) 단계 ID 형식(S3-04)이 아닙니다`);
      continue;
    }
    if (!anyDefined) continue; // 1단계: 단계 정의가 아직 없다
    const st = all.get(id);
    if (!st) errors.push(`--skip 값 ${id}은(는) 프리셋 ${preset.id}에 없는 단계입니다`);
    else if (st.core) errors.push(`--skip 값 ${id}은(는) 핵심 단계라 생략할 수 없습니다`);
  }
  return errors;
}
