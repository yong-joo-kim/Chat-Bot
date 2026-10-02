// 구축형 강조점 배지(ui-spec §4.4) — 증거 조건을 충족할 때만 표시한다(증거 없는 배지 금지). 주장 범위는 "서버 쪽 송신"이다.
import type { BadgeKey, FactChipKey, RunFacts, StepDef } from './types';

/** 배지에 쓰는 글자(자막 띠 · 보고서). */
export const BADGE_LABELS: Readonly<Record<BadgeKey, string>> = {
  ONPREM_INSTALL: '사내 설치',
  CPU_ONLY: 'CPU 동작',
  NO_EXTERNAL_SEND: '외부 송신 없음',
  EGRESS_GATE: '출구 통제',
  ONPREM_STORAGE: '사내 보관',
  HUMAN_APPROVAL: '사람 승인',
  AUDIT_TRAIL: '감사 기록',
  RETENTION: '보존·파기',
};

/** 자막 띠 한 번에 표시하는 배지 수의 상한(ui-spec §4.4). */
export const MAX_BADGES = 2;

/**
 * 배지 증거 조건. 앞의 4개는 하네스가 기동 때 확인한 사실, 나머지 4개는 "그 장면의 검증이 통과했을 때"만 증거가 된다(`stepVerified`).
 * - CPU 동작: 문장 분석 장치가 cpu 이고 GPU를 프로세스에 노출하지 않았다(`CUDA_VISIBLE_DEVICES=-1`).
 * - 외부 송신 없음: 서버 출구 키 중 값이 있는 것이 0개다(루프백 1곳 제외).
 * - 출구 통제: 데이터 거버넌스 모드가 켜져 있다(기동 실패로 꺼진 실행에서는 표시하지 않는다).
 */
export function badgeEvidence(key: BadgeKey, facts: RunFacts, stepVerified: boolean): boolean {
  switch (key) {
    case 'ONPREM_INSTALL':
      return true;
    case 'CPU_ONLY':
      // [DT-2] 지금 GPU를 쓰는 자식·모델이 하나라도 있으면 증거가 성립하지 않는다(설계 DXD-13). 10분판은 gpuActive가 없어 DT-1과 같다.
      return facts.device === 'cpu' && facts.gpuHidden && (facts.gpuActive?.length ?? 0) === 0;
    case 'NO_EXTERNAL_SEND':
      return facts.externalAddresses === 0;
    case 'EGRESS_GATE':
      return facts.governance === 'ON';
    case 'ONPREM_STORAGE':
    case 'HUMAN_APPROVAL':
    case 'AUDIT_TRAIL':
    case 'RETENTION':
      return stepVerified;
  }
}

/** 증거가 있는 배지만 글자로 돌려준다(최대 2개). */
export function resolveBadges(keys: readonly BadgeKey[] | undefined, facts: RunFacts, stepVerified: boolean): string[] {
  return (keys ?? []).filter((k) => badgeEvidence(k, facts, stepVerified)).map((k) => BADGE_LABELS[k]).slice(0, MAX_BADGES);
}

/** [DT-2] 사실 칩 글자(강조 배지와 구분 — 점선 칩). */
export const FACT_CHIP_LABELS: Readonly<Record<FactChipKey, string>> = {
  GPU_USED: 'GPU 사용',
  SYNTHETIC_VOICE: '합성 음성',
  CHECKED_ONLY: '동작 확인',
};

/** 풀 투어 자막 띠의 칩 합계 상한(사실 칩 + 강조 배지) — 10분판은 MAX_BADGES(2) 그대로. */
export const MAX_CHIPS_FULL = 3;

export interface ComposedChips {
  facts: string[];
  badges: string[];
  /** 표시하지 못한 배지와 이유(보고서 내부판 "구축형 배지 표시 내역"). */
  hidden: Array<{ badge: string; why: string }>;
}

/**
 * 한 단계의 사실 칩 + 강조 배지를 합친다(설계 → ui-spec §16.2.2).
 * - `GPU 사용` 칩은 지금 GPU를 쓰는 것이 있을 때만 · 'CPU 동작' 배지가 증거 불충족이면 그 자리를 `GPU 사용` 칩이 대신한다.
 * - 합계가 상한을 넘으면 강조 배지부터 뺀다(사실 칩 우선). 10분판(`full=false`)은 사실 칩이 없어 DT-1과 같은 결과다.
 */
export function composeChips(step: Pick<StepDef, 'facts' | 'badges'>, facts: RunFacts, stepVerified: boolean, full: boolean): ComposedChips {
  const gpuOn = (facts.gpuActive?.length ?? 0) > 0;
  const hidden: ComposedChips['hidden'] = [];
  const factKeys: FactChipKey[] = [];
  for (const k of step.facts ?? []) {
    if (k === 'GPU_USED' && !gpuOn) continue;
    factKeys.push(k);
  }
  let badgeKeys: BadgeKey[] = [];
  for (const b of step.badges ?? []) {
    if (badgeEvidence(b, facts, stepVerified)) badgeKeys.push(b);
    else if (b === 'CPU_ONLY' && gpuOn) {
      hidden.push({ badge: BADGE_LABELS.CPU_ONLY, why: `지금 GPU를 쓰는 것이 있어 표시하지 않음(${(facts.gpuActive ?? []).join(' · ')})` });
      if (full && !factKeys.includes('GPU_USED')) factKeys.push('GPU_USED');
    }
  }
  const max = full ? MAX_CHIPS_FULL : MAX_BADGES;
  const factLabels = factKeys.map((k) => FACT_CHIP_LABELS[k]).slice(0, max);
  const room = Math.max(0, max - factLabels.length);
  const dropped = badgeKeys.slice(room);
  for (const d of dropped) hidden.push({ badge: BADGE_LABELS[d], why: '칩 합계 상한(3)을 넘어 사실 칩을 우선함' });
  badgeKeys = badgeKeys.slice(0, room);
  return { facts: factLabels, badges: badgeKeys.map((k) => BADGE_LABELS[k]), hidden };
}
