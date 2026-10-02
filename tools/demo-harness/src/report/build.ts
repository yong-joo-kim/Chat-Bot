// result.json 조립(설계 §17.1) — 오케스트레이터가 모은 값에서 스키마 v1 객체를 만드는 순수 함수. 시계·파일 접근 없음(시험 가능).
import { publicOverrideValue } from './public-value';
import { ROADMAP, ROADMAP_STATUS_LABEL } from '../data/roadmap';
import type { OverrideRow } from '../env/api-env';
import type { ScenarioResult, StepResult } from '../scenario/runner';
import type { LiveScheduleState, SegmentDef } from '../scenario/types';
import type { FullRecord, GenerationRecord, SpeechRecord } from '../scenario/full-env';
import type { FullPlanJson, HonestyKind, ResultJson, StepResultJson } from './schema';
import { RESULT_SCHEMA_VERSION } from './schema';

export interface MachineInfo {
  os: string;
  cpu: string;
  cores: number;
  ramGb: number;
  freeRamGb: number;
  gpu: string;
}

/** [DT-2] 풀 투어 보고서 입력 — 없으면(10분판) 결과에 선택 키가 하나도 생기지 않는다. */
export interface FullReportInput {
  plan: FullPlanJson;
  models: NonNullable<ResultJson['models']>;
  vram: NonNullable<ResultJson['vram']>;
  vramMax: NonNullable<ResultJson['vramMax']>;
  speech: SpeechRecord | null;
  prepared: GenerationRecord | null;
  live: GenerationRecord | null;
  loadMs: number | null;
  unloaded: boolean | null;
  downloads: FullRecord['downloads'];
  proactive: FullRecord['proactive'];
  honesty: Array<{ stepId: string | null; kind: HonestyKind; text: string }>;
  badgeNotes: FullRecord['badgeNotes'];
  /** 하네스가 이 PC의 GPU를 썼는지(음성 cuda 또는 생성 모델 적재). */
  gpuUsed: boolean;
  childOverrides: OverrideRow[];
  audioStoreCheck?: ResultJson['audioStoreCheck'];
}

export interface BuildInput {
  runId: string;
  presetId: string;
  mode: 'visible' | 'headless-check';
  exitCode: number;
  startedAt: string;
  showStartedAt: string | null;
  endedAt: string;
  prepareSec: number;
  machine: MachineInfo;
  commit: { sha: string | null; dirty: boolean | null };
  browser: { kind: string; version: string | null; playwright: string; video: boolean };
  viewport: { width: number; height: number };
  latency: { samples: number; p50Ms: number; p95Ms: number; decidedTimeoutMs: number; source: 'measured' | 'manual'; rounds: Array<{ p50Ms: number; p95Ms: number }> } | null;
  overrides: OverrideRow[];
  /** 서버 출구 키 중 값이 있는 것(없으면 빈 배열 — 시연 API는 전부 미설정이어야 한다). */
  embeddingUrl: string;
  blocked: Array<{ host: string; count: number; firstStepId: string | null }>;
  network: { offline: boolean | null; checkedAt: string | null };
  scenario: ScenarioResult | null;
  /** 선택한(--only) 구간들 — 단계 정의 전체. */
  segments: SegmentDef[];
  skipOptionIds: string[];
  dataset: { historicalLogs: number; accounts: number; chatbots: number } | null;
  calibration: Array<{ id: string; scene: string; ok: boolean; detail: string }>;
  calibrated: boolean;
  teardown: { processesLeft: number; portsFreed: boolean; devDbUnchanged: boolean };
  prepare: Array<{ id: string; name: string; sec: number; status: 'OK' | 'SKIPPED' | 'FAILED' }>;
  prepareFailure?: { phase: string; message: string; why?: string; how?: string };
  media: { video: string | null; videoReason: string | null; vtt: string | null; gifs: string[] };
  warnings: string[];
  liveSchedule?: LiveScheduleState;
  governance?: { mode: 'ON' | 'OFF'; fallback: boolean; logLine: string | null };
  envKeyNames?: { blockedApi: string[]; blockedMlWorker: string[]; removedByPreload: string[] };
  customerCopy: boolean;
  /** [DT-2] 풀 투어 입력(10분판은 undefined). */
  full?: FullReportInput;
}

/** 종료 코드 → 상태(설계 §4.3). */
export function statusOf(exitCode: number): ResultJson['status'] {
  if (exitCode === 0) return 'PASSED';
  if (exitCode === 1) return 'FAILED';
  if (exitCode === 130) return 'ABORTED';
  return 'PREPARE_FAILED';
}

/** 단계별 정직성 종류(설계 §12 · FR-DH9) — 이 단계의 안내 문구는 "사전 준비·시연용 설정·과거 데이터"를 공개하는 것이다. */
const HONESTY_KIND_BY_STEP: Readonly<Record<string, HonestyKind>> = {
  'S0-01': 'DEMO_SETTING',
  'S3-02': 'HISTORICAL_DATA',
  'S5-07': 'PREPARED_RESULT',
  'S6-06': 'DEMO_SETTING',
  'S7-02': 'PREPARED_RESULT',
};

const SKIP_TEXT: Record<string, string> = { TIME: '시간 부족', PRESENTER: '진행자 선택', OPTION: '옵션', DEPENDENCY: '선행 실패', NO_BROWSER: '브라우저 없음' };
export function skipReasonText(r: string | null | undefined): string {
  return r ? (SKIP_TEXT[r] ?? r) : '';
}

function toStepJson(r: StepResult, resumeCmd: string | undefined, logs: Record<string, string>): StepResultJson {
  return {
    id: r.id,
    segment: r.segment,
    title: r.title,
    core: r.core,
    status: r.status,
    budgetSec: r.budgetSec,
    actualSec: Math.round(r.actualSec * 10) / 10,
    captures: r.captures,
    skipReason: r.skipReason ?? null,
    failure: r.failure ? { ...r.failure, logs, resume: resumeCmd } : null,
    delay: r.delay ?? null,
    narration: r.narration,
    badges: r.badges,
    verified: r.verified,
  };
}

/** 구간 키 → 재개 명령의 `--from` 값(S3). 설계 A-8: 단계 ID를 줘도 그 구간 처음부터 다시 한다. */
export function resumeFrom(segmentKey: string): string {
  return segmentKey === 'opening' ? 'S0' : segmentKey === 'closing' ? 'S9' : segmentKey.toUpperCase();
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function buildResult(i: BuildInput): ResultJson {
  const logs = { api: 'logs/api.log', 'ml-worker': 'logs/ml-worker.log', harness: 'logs/harness.log', 'browser-console': 'logs/browser-console.log' };
  const scen = i.scenario;
  const steps: StepResultJson[] = (scen?.steps ?? []).map((r) => toStepJson(r, r.status === 'FAIL' ? `pnpm demo -- --resume ${i.runId} --from ${resumeFrom(r.segment)}` : undefined, logs));
  const segResults = new Map((scen?.segments ?? []).map((s) => [s.key, s]));
  const segments: ResultJson['segments'] = i.segments.map((s) => {
    const r = segResults.get(s.key);
    if (!r || r.steps.length === 0) return { key: s.key, title: s.title, budgetSec: s.budgetSec, actualSec: 0, status: 'NOT_RUN' as const };
    const any = (st: string) => r.steps.some((x) => x.status === st);
    const status = any('FAIL') ? 'FAILED' : r.steps.every((x) => x.status === 'SKIPPED') ? 'SKIPPED' : 'PASSED';
    return { key: s.key, title: s.title, budgetSec: s.budgetSec, actualSec: Math.round(r.actualSec * 10) / 10, status };
  });

  // 정직성 표기(FR-DH9) — 사전 준비·시연용 설정·과거 데이터·대체·건너뜀을 종류별로 모두 공개한다.
  const honesty: ResultJson['honesty'] = [];
  for (const r of scen?.steps ?? []) {
    if (r.status === 'FALLBACK') honesty.push({ stepId: r.id, kind: 'FALLBACK', text: (r.honesty ?? [`${r.id}: 준비된 결과로 대신 보여 드렸습니다`])[0].replace(/^S[0-79VPE]-\d+: /, '') });
    else if (r.status === 'SKIPPED') honesty.push({ stepId: r.id, kind: 'SKIPPED', text: r.skipReason === 'OPTION' && r.honesty && r.honesty[0] ? r.honesty[0].replace(/^S[0-79VPE]-\d+: /, '') : `${r.title} · ${skipReasonText(r.skipReason)}` });
    else if (r.honesty && HONESTY_KIND_BY_STEP[r.id]) honesty.push({ stepId: r.id, kind: HONESTY_KIND_BY_STEP[r.id], text: r.honesty[0].replace(/^S[0-79VPE]-\d+: /, '') });
  }
  if (i.dataset && i.dataset.historicalLogs > 0) honesty.push({ stepId: null, kind: 'HISTORICAL_DATA', text: `시연용 과거 대화 기록 ${i.dataset.historicalLogs}건(그래프용 — 미리 넣은 데이터)` });
  if (i.calibrated) honesty.push({ stepId: null, kind: 'DEMO_SETTING', text: '준비 단계 보정: 의미 매칭 설정을 잠시 켰다 껐습니다(감사 로그 2행 · 임베딩 캐시 남음)' });
  if (i.liveSchedule?.status === 'CREATED' || i.prepare.some((p) => p.id === 'PW')) honesty.push({ stepId: null, kind: 'DEMO_SETTING', text: '준비 단계의 예약·승인 요청은 "최근 시험 실행 이력 없음" 경고를 확인한 것으로 처리했습니다' });
  if (i.liveSchedule && i.liveSchedule.status === 'CREATED' && !honesty.some((h) => h.stepId === 'S5-07' && h.kind === 'PREPARED_RESULT')) honesty.push({ stepId: 'S5-07', kind: 'PREPARED_RESULT', text: '예약과 두 번째 관리자의 사전 승인은 시연 시작 시점에 미리 처리했습니다' });
  if (i.full) honesty.push(...i.full.honesty);
  for (const o of i.overrides) if (o.disclosed && o.key === 'EMBEDDING_TIMEOUT_MS' && o.value !== o.defaultValue) honesty.push({ stepId: 'S0-01', kind: 'DEMO_SETTING', text: `문장 분석 대기 시간을 ${o.defaultValue}ms에서 ${o.value}ms로 바꿨습니다(이 노트북 CPU 실측)` });

  // 외부 송신 점검표(설계 §13.2 — 8칸)
  const checklist: ResultJson['egressChecklist'] = [
    { column: '서버 출구 키', item: 'EMBEDDING_BASE_URL', state: 'LOOPBACK', evidence: i.embeddingUrl },
    { column: '서버 출구 키', item: 'RAG_BASE_URL', state: 'UNSET' },
    { column: '서버 출구 키', item: 'AUGMENTATION_GEMINI_BASE_URL · 키 · 모델', state: 'UNSET', evidence: '값은 공개하지 않음' },
    i.full?.plan.localLlm ? { column: '서버 출구 키', item: 'AUGMENTATION_LOCAL_BASE_URL', state: 'LOOPBACK' as const, evidence: '사내 소형 생성 서버(이 PC 안 · 장면 10)' } : { column: '서버 출구 키', item: 'AUGMENTATION_LOCAL_BASE_URL', state: 'UNSET' as const },
    i.full?.plan.voiceInput === 'real' ? { column: '서버 출구 키', item: 'ML_WORKER_SPEECH_URL · SPEECH_ENABLED', state: 'LOOPBACK' as const, evidence: '음성 인식 서버(이 PC 안 · 장면 8)' } : { column: '서버 출구 키', item: 'ML_WORKER_SPEECH_URL · SPEECH_ENABLED', state: (i.full?.plan.voiceInput === 'mock' ? 'OFF' : 'UNSET') as 'OFF' | 'UNSET', evidence: i.full?.plan.voiceInput === 'mock' ? '모의 인식(서버 연결 없음 · 음성 인식 미검증)' : '음성 인식 서버 연결 없음(꺼짐)' },
    { column: '서버 출구 키', item: '업무 자동화 대상 · 지식베이스 동기화', state: 'OFF', evidence: '자동 발송·수집 루프 꺼짐' },
    { column: '증강 공급자', item: 'AUGMENTATION_PROVIDER', state: 'ON', evidence: i.full?.plan.localLlm ? '사내 소형 생성(local · Ollama 경량 구성)' : '규칙 기반(rule)' },
    { column: '거버넌스', item: '데이터 거버넌스 모드', state: i.governance?.mode === 'OFF' ? 'OFF' : 'ON', evidence: i.governance?.logLine ?? (i.governance?.fallback ? '기동 실패로 꺼진 상태로 재기동' : '기동 로그 줄을 찾지 못함') },
    { column: 'ml-worker', item: '바인드 · 오프라인 · 장치', state: 'LOOPBACK', evidence: i.full ? '문장 분석: 127.0.0.1 · 오프라인 모드 · cpu · GPU 비노출(음성 인식·생성은 별도 프로세스)' : '127.0.0.1 · 오프라인 모드 · cpu · GPU 비노출' },
    { column: '개발자 .env', item: '차단한 키 이름', state: 'UNSET', evidence: [...(i.envKeyNames?.blockedApi ?? []), ...(i.envKeyNames?.blockedMlWorker ?? [])].join(', ') || '키 없음' },
    ...(i.blocked.length > 0
      ? i.blocked.map((b) => ({ column: '브라우저', item: b.host, state: 'BLOCKED' as const, evidence: `${b.count}건 차단 · 최초 ${b.firstStepId ?? '-'}` }))
      : [{ column: '브라우저', item: '외부 요청', state: 'UNSET' as const, evidence: '차단 기록 0건' }]),
    { column: '네트워크', item: 'PC-9 관측', state: i.network.offline === null ? 'UNKNOWN' : i.network.offline ? 'BLOCKED' : 'OPEN', evidence: i.network.checkedAt ?? undefined },
  ];

  const prepareSec = i.prepareSec;
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    tool: 'DT-1',
    runId: i.runId,
    preset: i.presetId,
    mode: i.mode,
    status: statusOf(i.exitCode),
    exitCode: i.exitCode,
    commit: i.commit,
    startedAt: i.startedAt,
    showStartedAt: i.showStartedAt,
    endedAt: i.endedAt,
    durations: { prepareSec: Math.round(prepareSec), showSec: Math.round(scen?.showSec ?? 0), pausedSec: Math.round(scen?.pausedSec ?? 0) },
    machine: { ...i.machine, gpuUsedByHarness: i.full?.gpuUsed ?? false },
    browser: i.browser,
    embeddingLatency: i.latency ? { ...i.latency, p50Ms: round1(i.latency.p50Ms), p95Ms: round1(i.latency.p95Ms), rounds: i.latency.rounds.map((r) => ({ p50Ms: round1(r.p50Ms), p95Ms: round1(r.p95Ms) })) } : null,
    overrides: [...i.overrides, ...(i.full?.childOverrides ?? [])].filter((o) => o.disclosed).map((o) => ({ key: o.key, value: o.secret ? '[가림]' : publicOverrideValue(o.key, o.value), default: o.defaultValue, reason: o.reason })),
    egressChecklist: checklist,
    browserBlockedRequests: i.blocked,
    network: i.network,
    honesty,
    dataset: i.dataset,
    segments,
    steps,
    appendix: { llm: null },
    teardown: i.teardown,
    prepare: i.prepare,
    prepareFailure: i.prepareFailure,
    calibration: i.calibration,
    roadmap: ROADMAP.filter((r) => !(i.full?.plan.demonstratedNos ?? []).includes(r.featureNo)).map((r) => ({ featureNo: r.featureNo, name: r.name, why: r.why, status: ROADMAP_STATUS_LABEL[r.status] })),
    media: i.media,
    warnings: i.warnings,
    liveSchedule: i.liveSchedule
      ? { status: i.liveSchedule.status, scheduledAt: i.liveSchedule.scheduledAt, finalStatus: i.liveSchedule.finalStatus, error: i.liveSchedule.error }
      : undefined,
    governance: i.governance,
    envKeyNames: i.envKeyNames,
    viewport: i.viewport,
    customerCopy: i.customerCopy,
    ...(i.full
      ? {
          plan: i.full.plan,
          models: i.full.models,
          vram: i.full.vram,
          vramMax: i.full.vramMax,
          speech: i.full.speech
            ? { ...i.full.speech }
            : null,
          localLlm: i.full.plan.localLlm || i.full.prepared || i.full.live ? { prepared: i.full.prepared, live: i.full.live, loadMs: i.full.loadMs, unloaded: i.full.unloaded } : null,
          downloads: i.full.downloads,
          proactive: i.full.proactive,
          badgeNotes: i.full.badgeNotes,
          audioStoreCheck: i.full.audioStoreCheck,
          childOverrides: i.full.childOverrides.filter((o) => o.disclosed).map((o) => ({ key: o.key, value: o.secret ? '[가림]' : publicOverrideValue(o.key, o.value), default: o.defaultValue, reason: o.reason })),
        }
      : {}),
  };
}
