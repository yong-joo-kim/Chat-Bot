// [DT-2] 계획 문맥(PlanContext) · 조건부 단계 해석기 · 대표 계획 16개 · 고객용 문구 단일 원천(설계 §3 · ADR-0053 §1).
// 실행 전에 계획 문맥을 확정하고, 프리셋의 단계·구간은 `when(plan)`으로 활성 여부가 정해진다. 예산은 활성 단계 합이다.
// 10분판은 `when`이 하나도 없어 해석 결과가 정적 정의와 같다(H-T19 ⑥).
import type { InactiveReason, PresetDef, SegmentDef, StepDef } from './types';

export type VoiceInputPlan = 'off' | 'real' | 'mock';
export type SttDevice = 'cuda' | 'cpu';
export type SttModel = 'large-v3-turbo' | 'small';
export type SttRequest = 'auto' | 'cuda' | 'cpu';

export interface DeviceNote {
  /** SELECTED = auto가 조건 미충족으로 cpu를 고름 · FALLBACK = cuda 기동 실패로 cpu 재기동. */
  kind: 'SELECTED' | 'FALLBACK';
  reason: string;
}

export interface PlanContext {
  presetId: string;
  mode: 'visible' | 'headless-check';
  /** 풀 투어(모델 장면 플래그를 받는 프리셋)인지. */
  full: boolean;
  voiceInput: VoiceInputPlan;
  /** voiceInput=real일 때만 값. */
  sttDevice: SttDevice | null;
  sttModel: SttModel | null;
  sttRequested: SttRequest;
  localLlm: boolean;
  liveClustering: boolean;
  /** 사용자가 플래그를 켰는지(불가로 꺼졌더라도 true) — 생략 사유 종류(NOT_REQUESTED/UNAVAILABLE)의 근거. */
  voiceRequested: boolean;
  llmRequested: boolean;
  /** 켰지만 이 PC에서 불가해 생략한 이유(보이는 시연 · P-DX-10). 있으면 voiceInput='off'. */
  voiceOmittedReason?: string;
  llmOmittedReason?: string;
  /** 음성 인식 장치 선택·대체 사실(공개). */
  deviceNote?: DeviceNote | null;
}

/** 10분판의 고정 계획(모든 플래그 꺼짐). */
export function defaultPlan(presetId: string, mode: PlanContext['mode']): PlanContext {
  return {
    presetId,
    mode,
    full: false,
    voiceInput: 'off',
    sttDevice: null,
    sttModel: null,
    sttRequested: 'auto',
    localLlm: false,
    liveClustering: false,
    voiceRequested: false,
    llmRequested: false,
    deviceNote: null,
  };
}

/** 대표 계획 키(`expectedTotals`의 키) — 음성 장치는 예산에 영향이 없어 키에 넣지 않는다. */
export function planKey(p: Pick<PlanContext, 'voiceInput' | 'localLlm' | 'liveClustering'>): string {
  return `v:${p.voiceInput}|l:${p.localLlm ? 1 : 0}|c:${p.liveClustering ? 1 : 0}`;
}

/** 정의 검사가 해석하는 대표 계획 16개(voice 4종 × llm 2 × clustering 2). `voiceOmittedReason`이 있는 계획은 off와 같은 모양이다. */
export const PLAN_MATRIX: readonly PlanContext[] = (() => {
  const out: PlanContext[] = [];
  const voices: Array<{ v: VoiceInputPlan; d: SttDevice | null }> = [
    { v: 'off', d: null },
    { v: 'real', d: 'cuda' },
    { v: 'real', d: 'cpu' },
    { v: 'mock', d: null },
  ];
  for (const { v, d } of voices) {
    for (const llm of [false, true]) {
      for (const cl of [false, true]) {
        out.push({
          presetId: 'matrix',
          mode: v === 'mock' ? 'headless-check' : 'visible',
          full: true,
          voiceInput: v,
          sttDevice: d,
          sttModel: v === 'real' ? (d === 'cuda' ? 'large-v3-turbo' : 'small') : null,
          sttRequested: 'auto',
          localLlm: llm,
          liveClustering: cl,
          voiceRequested: v !== 'off',
          llmRequested: llm,
          deviceNote: v === 'real' && d === 'cpu' ? { kind: 'SELECTED', reason: '시험용 대표 계획' } : null,
        });
      }
    }
  }
  return out;
})();

// ── 파생 사실 · 고객용 문구(시작 카드·터미널·보고서·로드맵이 같은 함수를 쓴다) ──
export type GpuUse = 'none' | 'stt' | 'llm' | 'both';

export function gpuUse(p: PlanContext): GpuUse {
  const stt = p.voiceInput === 'real' && p.sttDevice === 'cuda';
  if (stt && p.localLlm) return 'both';
  if (stt) return 'stt';
  if (p.localLlm) return 'llm';
  return 'none';
}

/** GPU 사용 4상태 고객용 한 줄(ui-spec §16.5.1 · 단일 원천). */
export const GPU_USE_TEXT: Readonly<Record<GpuUse, string>> = {
  none: '사용하지 않음',
  stt: '음성 인식에 사용',
  llm: '사내 생성 모델에만 사용 (장면 10)',
  both: '음성 인식 + 사내 생성 모델 (장면 10 전에 음성 인식을 내립니다)',
};

/** 데이터 출구(허용) 이름 목록 — 항상 문장 분석 1곳 + 켠 모델 자식(이 PC 안). */
export function egressNames(p: PlanContext): string[] {
  const out = ['문장 분석'];
  if (p.voiceInput === 'real') out.push('음성 인식');
  if (p.localLlm) out.push('소형 생성');
  return out;
}

/** 자식 프로세스 이름(시작 카드 `서버 N개`). */
export function serverNames(p: PlanContext): string[] {
  const out = ['API', '문장 분석'];
  if (p.voiceInput === 'real') out.push('음성 인식');
  if (p.localLlm) out.push('소형 생성');
  return out;
}

export const SCENE_NAME_VOICE_INPUT = '음성으로 묻기(눌러서 말하기)';
export const SCENE_NAME_EDGE = '사내 소형 생성 모델 장면';

const CUSTOMER_NOT_REQUESTED = '이번 구성에서 켜지 않아 보여 드리지 않았습니다';
const CUSTOMER_UNAVAILABLE = '이 PC에서 준비하지 못해 생략했습니다';

export function voiceInactiveReason(p: PlanContext): InactiveReason {
  if (p.voiceRequested) {
    return {
      kind: 'UNAVAILABLE',
      sceneName: SCENE_NAME_VOICE_INPUT,
      customer: CUSTOMER_UNAVAILABLE,
      internal: `${SCENE_NAME_VOICE_INPUT} - 준비 실패: ${p.voiceOmittedReason ?? '사유 미상'} (--with-voice-input)`,
    };
  }
  return {
    kind: 'NOT_REQUESTED',
    sceneName: SCENE_NAME_VOICE_INPUT,
    customer: CUSTOMER_NOT_REQUESTED,
    internal: `${SCENE_NAME_VOICE_INPUT} - 옵션 미지정 (--with-voice-input)`,
  };
}

export function edgeInactiveReason(p: PlanContext): InactiveReason {
  if (p.llmRequested) {
    return {
      kind: 'UNAVAILABLE',
      sceneName: SCENE_NAME_EDGE,
      customer: CUSTOMER_UNAVAILABLE,
      internal: `${SCENE_NAME_EDGE} - 준비 실패: ${p.llmOmittedReason ?? '사유 미상'} (--with-local-llm)`,
    };
  }
  return {
    kind: 'NOT_REQUESTED',
    sceneName: SCENE_NAME_EDGE,
    customer: CUSTOMER_NOT_REQUESTED,
    internal: `${SCENE_NAME_EDGE} - 옵션 미지정 (--with-local-llm)`,
  };
}

/** 고객 화면에 쓰는 생략 한 줄 `{장면 이름} - {사유}`. */
export function omitCustomerLine(r: InactiveReason): string {
  return `${r.sceneName} - ${r.customer}`;
}

/** 해석에서 빠진 단계(옵션 생략) 한 건. */
export interface InactiveRow {
  stepId: string;
  segment: string;
  title: string;
  reason: InactiveReason;
}

export interface ResolvedPreset {
  segments: SegmentDef[];
  totalBudgetSec: number;
  inactiveRows: InactiveRow[];
  /** 비활성 구간 키(구간 전체가 옵션으로 빠진 것). */
  inactiveSegments: Array<{ key: string; title: string; reason: InactiveReason }>;
  /** 활성 장면(s1~s7·voice·proactive·edge) 수 N. */
  sceneCount: number;
}

const GENERIC_REASON = (title: string): InactiveReason => ({ kind: 'NOT_REQUESTED', sceneName: title, customer: CUSTOMER_NOT_REQUESTED, internal: `${title} - 옵션 미지정` });

/** 프리셋 + 계획 문맥 → 활성 구간·단계만 남긴 정의(구간 예산 = 활성 단계 합 · 칩은 `autoChips`일 때 `장면 i/N`). */
export function resolvePreset(preset: PresetDef, plan: PlanContext): ResolvedPreset {
  const conditional = preset.autoChips === true || preset.segments.some((s) => s.when !== undefined || s.steps.some((st) => st.when !== undefined));
  if (!conditional) {
    return {
      segments: preset.segments,
      totalBudgetSec: preset.totalBudgetSec,
      inactiveRows: [],
      inactiveSegments: [],
      sceneCount: preset.segments.filter((s) => /^s\d$/.test(s.key)).length,
    };
  }
  const segments: SegmentDef[] = [];
  const inactiveRows: InactiveRow[] = [];
  const inactiveSegments: ResolvedPreset['inactiveSegments'] = [];
  for (const seg of preset.segments) {
    const segActive = seg.when ? seg.when(plan) : true;
    const active: StepDef[] = [];
    for (const st of seg.steps) {
      const on = segActive && (st.when ? st.when(plan) : true);
      if (on) {
        active.push(st);
        continue;
      }
      if (segActive && st.inactive === 'variant') continue; // 같은 ID의 다른 변형이 대신 활성 — 보고하지 않는다
      const reason = !segActive ? (seg.inactiveReason ?? (() => GENERIC_REASON(seg.title)))(plan) : (st.inactiveReason ?? (() => GENERIC_REASON(st.title)))(plan);
      inactiveRows.push({ stepId: st.id, segment: seg.key, title: st.title, reason });
    }
    if (!segActive || active.length === 0) {
      inactiveSegments.push({ key: seg.key, title: seg.title, reason: (seg.inactiveReason ?? (() => GENERIC_REASON(seg.title)))(plan) });
      continue;
    }
    const ids = new Set(active.map((s) => s.id as string));
    segments.push({
      ...seg,
      steps: active,
      budgetSec: active.reduce((n, s) => n + s.budgetSec, 0),
      skipOrder: seg.skipOrder.filter((id) => ids.has(id) && active.some((a) => a.id === id && a.skippable)),
    });
  }
  const scenes = segments.filter((s) => s.key !== 'opening' && s.key !== 'closing');
  const n = scenes.length;
  let i = 0;
  const withChips = segments.map((s) => {
    if (!preset.autoChips || s.key === 'opening' || s.key === 'closing') return s;
    i += 1;
    return { ...s, chip: `장면 ${i}/${n}` };
  });
  return {
    segments: withChips,
    totalBudgetSec: withChips.reduce((m, s) => m + s.budgetSec, 0),
    inactiveRows,
    inactiveSegments,
    sceneCount: n,
  };
}

/** 구간 키 → 고객이 보는 장면 이름(로드맵 "오늘 보여 드린 N가지" 목록) — 활성 장면 순서. */
export const SCENE_TITLES: Readonly<Record<string, string>> = {
  s1: '챗봇 구축과 위젯 대화',
  s2: '상담원 인계',
  s3: '통계와 대시보드',
  s4: '학습 개선 루프',
  s5: '버전과 배포 통제',
  s6: '개인정보와 안전',
  s7: '발화 묶음 분석',
  voice: '음성 응대',
  proactive: '먼저 말 거는 안내',
  edge: '사내 소형 생성 모델',
};

/** 로드맵 슬라이드가 "오늘 시연한 기능 번호"로 제외하는 번호 — 장면 8(음성)이 항상 활성이므로 No.32. */
export function demonstratedFeatureNos(segments: readonly SegmentDef[]): number[] {
  const out: number[] = [];
  if (segments.some((s) => s.key === 'voice')) out.push(32);
  return out;
}

/** 해석 결과에서 활성 장면 이름 목록(왼쪽 "시연 완료" 목록). */
export function activeSceneTitles(segments: readonly SegmentDef[]): string[] {
  return segments.filter((s) => s.key !== 'opening' && s.key !== 'closing').map((s) => SCENE_TITLES[s.key] ?? s.title);
}

/** 고객용 생략 줄(중복 장면 이름은 한 줄로 · 입력 순서 유지). */
export function omittedCustomerLines(rows: readonly InactiveRow[], segs: ResolvedPreset['inactiveSegments']): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const all: InactiveReason[] = [...segs.map((s) => s.reason), ...rows.map((r) => r.reason)];
  for (const r of all) {
    const line = omitCustomerLine(r);
    // 같은 장면 이름은 사유 종류가 같으면 한 줄만(구간 전체 생략 + 단계 생략이 겹치는 경우)
    const key = `${r.sceneName}|${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
