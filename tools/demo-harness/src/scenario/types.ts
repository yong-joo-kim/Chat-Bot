import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { ApiSession } from '../data/api-client';
import type { DatasetIds } from '../data/types';
import type { StageController } from '../browser/session';
import type { FullStepEnv } from './full-env';
import type { PlanContext } from './plan';

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

/** [DT-2] 사실 칩 3종(설계 → ui-spec §16.2.2). */
export type FactChipKey = 'GPU_USED' | 'SYNTHETIC_VOICE' | 'CHECKED_ONLY';

/** [DT-2] 생략 사유 두 종류(ui-spec §16.5.3) — 고객용·내부용 문구를 따로 가진다. */
export interface InactiveReason {
  kind: 'NOT_REQUESTED' | 'UNAVAILABLE';
  /** 고객 화면용 장면 이름(옵션 이름 없음). */
  sceneName: string;
  /** 고객용 한 줄(`--` 토큰·포트 금지). */
  customer: string;
  /** 터미널·보고서 내부판 한 줄(옵션 이름 포함 가능). */
  internal: string;
  /** true면 고객 화면의 "생략한 장면" 줄에 올리지 않는다(생략이 아니라 다른 장면으로 옮겨 보이는 경우 — 예: S4-03). */
  hidden?: boolean;
}

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

export type SegmentKey = 'opening' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 'voice' | 'proactive' | 'edge' | 'closing';

/** 10분판의 구간 키(9개 · 순서 고정 — DT-1 정의 검사의 기준). */
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

/** [DT-2] 전역 구간 순서 — 프리셋은 이 순서의 부분열만 허용한다(⑩ 뒤 음성 장면 금지가 구조로 강제된다 · 설계 DXD-3). */
export const ALL_SEGMENT_KEYS: readonly SegmentKey[] = [
  'opening',
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  'voice',
  'proactive',
  'edge',
  'closing',
];

/** 구간 키 → 단계 ID 접두(S0 = 시작, S9 = 끝, SV·SP·SE = 풀 투어 신규 장면). */
export const SEGMENT_NUMBER: Readonly<Record<SegmentKey, number | string>> = {
  opening: 0,
  s1: 1,
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  s6: 6,
  s7: 7,
  voice: 'V',
  proactive: 'P',
  edge: 'E',
  closing: 9,
};

export type StepId = `S${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 'V' | 'P' | 'E'}-${string}`;

/** 단계 ID 정규식(인자 `--skip`·`--inject-delay` · 설계 §3.4). */
export const STEP_ID_RE = /^S[0-79VPE]-\d{2}$/;

export type AccountKey = 'admin1' | 'admin2' | 'agent';

/** 라이브 예약 C-2(공연 시작 T0에 만든다 — 설계 DHD-8 · §7.6). */
export interface LiveScheduleState {
  /** CREATED = 예약·요청·승인까지 완료 / FAILED = 생성 실패(S5-07 대체) / SKIPPED = 만들지 않음(무인 점검 기본). */
  status: 'CREATED' | 'FAILED' | 'SKIPPED';
  scheduleId?: string;
  scheduledAt?: string;
  approvalId?: string;
  targetVersionId?: string;
  baseVersionId?: string;
  error?: string;
  /** 공연 중 확인한 실행 결과(SUCCEEDED 등) — 보고서·S9-02용. */
  finalStatus?: string;
}

/** 비밀이 아닌 실행 상태(구간 끝마다 state.json에 저장 — 재개용). */
export interface RunState {
  /** 데모 데이터 생성 결과(DatasetIds — data/types.ts). */
  dataset?: unknown;
  chatbotIds?: { A?: string; B?: string; C?: string };
  /** 그 밖의 비밀 아닌 ID들(버전·예약·분석·세트 등) — 단계 정의가 키를 정한다. */
  ids?: Record<string, string | number>;
  /** 공연 시작 직전 통계 기준값(장면 3 대조용). */
  statsBaseline?: { turnCount: number; unansweredCount: number };
  /** 라이브 예약 C-2(장면 5 · 마무리). */
  liveSchedule?: LiveScheduleState;
}

/** 시나리오가 읽는 "하네스가 확인한 사실"과 시연용 설정(시작 카드·정직성 자막·배지 증거). */
export interface RunFacts {
  device: string;
  gpuHidden: boolean;
  governance: 'ON' | 'OFF';
  /** 서버 출구 키 중 값이 있는 것의 개수(0이어야 "외부 송신 없음" 배지가 증거를 갖는다). */
  externalAddresses: number;
  /** 단건 임베딩 대기 시간(ms) — 기본이 아니면 시연용 설정으로 시작 자막에 공개한다. */
  embeddingTimeoutMs: number;
  embeddingTimeoutDefault: number;
  /** 거버넌스 ON 기동 실패로 OFF 재기동했는지. */
  governanceFallback: boolean;
  /**
   * [DT-2] 지금 이 PC의 GPU를 쓰는 것들(음성 인식 cuda 자식 · 하네스가 적재한 Ollama 모델) — 공연 중 갱신된다.
   * 비어 있지 않으면 "CPU 동작" 배지의 증거가 성립하지 않는다(설계 DXD-13). 10분판은 undefined(= 항상 빔).
   */
  gpuActive?: string[];
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
  /** 하네스가 확인한 사실(시작 카드·배지 증거·시연용 설정 공개). */
  readonly facts: RunFacts;
  /** 하네스 픽스처 위치. */
  readonly paths: { fixtureCsv: string };
  /** [DT-2] 계획 문맥(10분판은 모든 플래그가 꺼진 고정 값). */
  readonly plan: PlanContext;
  /** [DT-2] 풀 투어 전용 실행 환경(음성·생성·GPU·다운로드). 10분판은 undefined. */
  readonly full?: FullStepEnv;
  /** 조건 대기(고정 지연 금지 — H-S2). */
  waitFor<T>(check: () => Promise<T | false | null | undefined> | T | false | null | undefined, o: { timeoutMs: number; intervalMs?: number; label: string; isFatal?: (e: unknown) => boolean }): Promise<T>;
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
  /** [DT-2] 실행 시점에 정해지는 자막 본문(예: S7-02가 방금 돌린 분석인지 사전 분석인지). 값이 있으면 `narration`보다 우선한다. */
  dynamicNarration?: (ctx: StepContext) => string[] | undefined | Promise<string[] | undefined>;
  /** [DT-2] 사실 칩(강조 배지와 구분 — 이 단계가 활성인 동안 알릴 사실). */
  facts?: FactChipKey[];
  /** [DT-2] 활성 조건(없으면 항상). 풀 투어 해석기가 계획 문맥으로 평가한다. */
  when?: (p: PlanContext) => boolean;
  /** [DT-2] 비활성일 때: 'variant' = 같은 ID의 다른 변형이 대신 활성(보고하지 않음) · 'option' = 생략(OPTION)으로 남김. 기본 'option'. */
  inactive?: 'variant' | 'option';
  /** [DT-2] 'option' 비활성의 사유(보고서·로드맵 줄). */
  inactiveReason?: (p: PlanContext) => InactiveReason;
  /** 실행 시점에 정해지는 안내 줄(예: 시연용으로 바꾼 설정이 있을 때만). 값이 있으면 `disclosure`보다 우선한다. */
  dynamicDisclosure?: (ctx: StepContext) => string | undefined | Promise<string | undefined>;
  /** 이 단계가 생략되면 이 단계(생략 가능)를 핵심으로 승격한다(S6-05는 S0-02가 생략되면 핵심 — 설계 §10.7). */
  promoteIfSkipped?: StepId;
  badges?: BadgeKey[];
  budgetSec: number;
  driver: Driver;
  account?: AccountKey;
  layout: Layout;
  /** 콘솔 iframe 경로(챗봇 ID 등은 ctx가 아니라 RunState의 dataset에서). 없으면 이동하지 않는다. */
  console?: (ids: DatasetIds) => string;
  site?: 'A' | 'B' | 'D';
  /** 핵심 장면 — 생략 불가. */
  core: boolean;
  /** 생략 가능 — core와 동시에 true 금지(정의 검사). */
  skippable: boolean;
  capture: Capture;
  /** 이 단계 전체의 상한(ms) — 없으면 max(60초, 예산 x 4초). 무인 점검의 실제 분석·예약 실행 대기처럼 긴 대기가 있는 단계만 넓힌다. */
  waitMaxMs?: number;
  run(ctx: StepContext): Promise<void>;
  verify?(ctx: StepContext): Promise<VerifyResult>;
  fallback?: {
    stepId?: string;
    render?(ctx: StepContext): Promise<void>;
    caption: string;
    /** 대체 자막의 안내 줄(기본 "준비된 결과로 대신 보여 드립니다"). */
    notice?: string;
    /** [DT-2] 실행 시점에 대체 문구를 고른다(예: SE-02 — 폴백 사실 vs 사전 결과). 있으면 `caption`·`notice`보다 우선한다. */
    captionFor?(ctx: StepContext): { caption: string; notice?: string };
  };
  headless?: 'same' | 'skip' | ((ctx: StepContext) => Promise<void>);
}

export interface SegmentDef {
  key: SegmentKey;
  /** [DT-2] 구간 활성 조건(없으면 항상). */
  when?: (p: PlanContext) => boolean;
  /** [DT-2] 구간이 비활성일 때의 사유. */
  inactiveReason?: (p: PlanContext) => InactiveReason;
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
  /** [DT-2] 이 프리셋이 받는 모델 플래그(없으면 플래그를 거부 — 10분판). */
  flags?: Array<'voiceInput' | 'localLlm' | 'liveClustering'>;
  /** [DT-2] 대표 계획별 총 예산 선언(정의 검사가 해석 결과와 대조). 키 = `planKey(plan)`. */
  expectedTotals?: Record<string, number>;
  /** [DT-2] true면 해석기가 장면 구간 칩을 `장면 i/N`(N = 활성 장면 수)으로 채운다. */
  autoChips?: boolean;
}
