import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { ApiSession } from '../data/api-client';
import type { DatasetIds } from '../data/types';
import type { StageController } from '../browser/session';

// 시나리오 정의 형식(설계 §9.1) — ui-spec §13 조정(A-1 자막 줄 길이 · A-2 captionPosition 폐기 · A-4 badges)을 반영한다.
// 1단계에서는 형식과 빈 구간 슬롯만 둔다. 단계 정의(run/verify)와 StepContext의 실제 능력은 다음 단계(H4·H5)에서 채운다.

export type Driver = 'API' | 'UI' | 'MIXED';
export type Layout = 'card' | 'split' | 'console';
export type Capture = 'none' | 'screenshot' | 'gif-clip';
export type FailureKind =
  | 'PREFLIGHT'
  | 'BUILD'
  | 'BOOT'
  | 'DATA'
  | 'ACTION'
  | 'TIMEOUT'
  | 'VERIFY'
  | 'SELECTOR'
  | 'TEARDOWN';

/** 구축형 강조점 배지 8종(ui-spec §4.4) — 증거 조건을 충족할 때만 표시한다. */
export type BadgeKey =
  | 'ONPREM_INSTALL' // 사내 설치
  | 'CPU_ONLY' // CPU 동작
  | 'NO_EXTERNAL_SEND' // 외부 송신 없음
  | 'EGRESS_GATE' // 출구 통제
  | 'ONPREM_STORAGE' // 사내 보관
  | 'HUMAN_APPROVAL' // 사람 승인
  | 'AUDIT_TRAIL' // 감사 기록
  | 'RETENTION'; // 보존·파기

export const BADGE_KEYS: readonly BadgeKey[] = [
  'ONPREM_INSTALL',
  'CPU_ONLY',
  'NO_EXTERNAL_SEND',
  'EGRESS_GATE',
  'ONPREM_STORAGE',
  'HUMAN_APPROVAL',
  'AUDIT_TRAIL',
  'RETENTION',
];

export type SegmentKey = 'opening' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 'closing';

export const SEGMENT_KEYS: readonly SegmentKey[] = [
  'opening',
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  'closing',
];

/** 구간 키 → 단계 ID 접두 숫자(S0 = 시작, S9 = 끝). */
export const SEGMENT_NUMBER: Readonly<Record<SegmentKey, number>> = {
  opening: 0,
  s1: 1,
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  s6: 6,
  s7: 7,
  closing: 9,
};

export type StepId = `S${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9}-${string}`;

export type AccountKey = 'admin1' | 'admin2' | 'agent';

/** 비밀이 아닌 실행 상태(구간 끝마다 state.json에 저장 — 재개용). 값은 다음 단계에서 채운다. */
export interface RunState {
  /** 데모 데이터 생성 결과(DatasetIds — data/types.ts). */
  dataset?: unknown;
  chatbotIds?: { A?: string; B?: string; C?: string };
  /** 그 밖의 비밀 아닌 ID들(버전·예약·분석·세트 등) — 단계 정의가 키를 정한다. */
  ids?: Record<string, string | number>;
}

export interface VerifyResult {
  ok: boolean;
  expected?: string;
  actual?: string;
}

/** 계정별 API 세션(실제 로그인으로 받은 쿠키는 메모리에만). */
export type ApiSessions = Record<'admin1' | 'admin2' | 'agent' | 'editor' | 'viewer', ApiSession>;

/** 입력 속도 규칙(설계 §11.2 · FR-DH4-5) — 보이는 시연은 글자당 지연, 무인 점검은 즉시 채운다. */
export interface Pacing {
  /** 글자를 입력한다(보이는 시연: 글자당 약 70ms, 무인: fill). */
  type(target: Locator, text: string): Promise<void>;
}

/** 단계 실행 문맥 — 브라우저·API·무대 제어·대기 규약. 선택자는 selectors/*에서만 만든다(NFR-DHM1). */
export interface StepContext {
  readonly runId: string;
  readonly mode: 'visible' | 'headless-check';
  readonly state: RunState;
  readonly signal: AbortSignal;
  readonly ids: DatasetIds;
  readonly api: ApiSessions;
  readonly page: Page;
  readonly stage: StageController;
  /** 무대 안 관리 콘솔 iframe / 고객사 모형 iframe. */
  readonly console: FrameLocator;
  readonly site: FrameLocator;
  readonly pace: Pacing;
  readonly urls: { stage: string; apiBase: string; console(path: string): string; site(slug: string): string; publicApi: string };
  /** 현재 콘솔 계정(스위치는 runner가 step.account로 처리). */
  readonly account: () => AccountKey;
  /** 단계 사이에 값을 넘긴다(예: 위젯 세션에서 만든 질문 텍스트). */
  readonly scratch: Map<string, unknown>;
  /** 조건 대기(고정 지연 금지 — H-S2). */
  waitFor<T>(check: () => Promise<T | false | null | undefined> | T | false | null | undefined, o: { timeoutMs: number; intervalMs?: number; label: string }): Promise<T>;
  log(msg: string): void;
  /** 콘솔 iframe을 이동하고 load까지 기다린다. */
  openConsole(path: string): Promise<void>;
  /** 위젯 모형 iframe을 이동하고 load까지 기다린다(챗봇 slug). */
  openSite(slug: string): Promise<void>;
}

export interface StepDef {
  id: StepId;
  /** 보고서·터미널 제목(ui-spec A-9 — 원문자·화살표 금지). */
  title: string;
  /** 자막 본문 1~2줄(줄당 <= 40자 — ui-spec A-1). */
  narration: string[];
  /** 정직성 안내 줄(<= 40자 — ui-spec A-4). 있으면 자막 띠 안내 줄에 표시. */
  disclosure?: string;
  badges?: BadgeKey[];
  budgetSec: number;
  driver: Driver;
  account?: AccountKey;
  layout: Layout;
  /** 콘솔 iframe 경로(챗봇 ID 등은 ctx가 아니라 RunState의 dataset에서). 없으면 이동하지 않는다. */
  console?: (ids: DatasetIds) => string;
  site?: 'A' | 'B';
  /** 핵심 장면 — 생략 불가. */
  core: boolean;
  /** 생략 가능 — core와 동시에 true 금지(정의 검사). */
  skippable: boolean;
  capture: Capture;
  waitMaxMs?: number;
  run(ctx: StepContext): Promise<void>;
  verify?(ctx: StepContext): Promise<VerifyResult>;
  fallback?: { stepId?: string; render?(ctx: StepContext): Promise<void>; caption: string };
  headless?: 'same' | 'skip' | ((ctx: StepContext) => Promise<void>);
}

export interface SegmentDef {
  key: SegmentKey;
  /** 상단 바·터미널·보고서 공용 칩(ui-spec §3.5). */
  chip: string;
  title: string;
  budgetSec: number;
  /** 시간 부족 시 생략 순서 — 그 구간의 생략 가능 단계 ID만. */
  skipOrder: string[];
  steps: StepDef[];
  /** 1단계 빈 슬롯 표시 — true이면 steps가 비어 있어도 정의 검사가 단계 예산 합을 요구하지 않는다. */
  slot?: boolean;
}

export interface PresetDef {
  id: string;
  audience: 'ONPREM';
  totalBudgetSec: number;
  segments: SegmentDef[];
  modesAllowed: ('visible' | 'headless-check')[];
}
