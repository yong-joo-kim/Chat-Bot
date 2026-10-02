// result.json 스키마 v1(설계 §17.1) — 기계 판정용 단일 원천. 보고서 HTML·마크다운은 이 객체에서만 만든다.
// 필수 필드는 설계 §17.1 그대로이고, 보고서 절을 채우는 데 필요한 값(준비 시간·로드맵·GIF 등)은 선택 필드로 더한다(스키마 버전은 1 그대로 — 필드 추가만).
import { z } from 'zod';

export const RESULT_SCHEMA_VERSION = 1;

const StepFailure = z.object({
  kind: z.enum(['PREFLIGHT', 'BUILD', 'BOOT', 'DATA', 'ACTION', 'TIMEOUT', 'VERIFY', 'SELECTOR', 'TEARDOWN']),
  message: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  /** 첨부 로그 파일(실행 폴더 기준 상대 경로). */
  logs: z.record(z.string()).optional(),
  /** 재개 명령(구간 단위). */
  resume: z.string().optional(),
});

export const StepResultSchema = z.object({
  id: z.string(),
  segment: z.string(),
  title: z.string(),
  core: z.boolean(),
  status: z.enum(['PASS', 'FAIL', 'SKIPPED', 'FALLBACK']),
  budgetSec: z.number(),
  actualSec: z.number(),
  captures: z.array(z.string()),
  skipReason: z.enum(['TIME', 'PRESENTER', 'OPTION', 'DEPENDENCY', 'NO_BROWSER']).nullable(),
  failure: StepFailure.nullable(),
  /** 지연 표식("지연 +0:08") — 보이는 시연만. */
  delay: z.string().nullable().optional(),
  /** 화면에 나간 자막(나레이션 로그). */
  narration: z.object({ lines: z.array(z.string()), notice: z.string().optional() }).optional(),
  /** 증거 조건을 충족해 표시한 배지. */
  badges: z.array(z.string()).optional(),
  /** 검증이 돌려준 기대값/실제값(통과여도 남긴다). */
  verified: z.object({ expected: z.string().optional(), actual: z.string().optional() }).optional(),
});
export type StepResultJson = z.infer<typeof StepResultSchema>;

export const HonestyKind = z.enum([
  'MOCK',
  'PREPARED_RESULT',
  'DEMO_SETTING',
  'FALLBACK',
  'SKIPPED',
  'HISTORICAL_DATA',
  // [DT-2] 풀 투어 추가 종류(설계 §12.2) — 풀 투어 결과에서만 나타난다
  'SYNTHETIC_INPUT',
  'GPU_USED',
  'QUALITY_UNVERIFIED',
  'NO_AUDIO',
  'DEVICE_FALLBACK',
]);
export type HonestyKind = z.infer<typeof HonestyKind>;

// ── [DT-2] 풀 투어 선택 필드(스키마 v1 유지 — 10분판 결과에는 이 키가 하나도 없다) ──
const SpeechJson = z.object({
  expected: z.string(),
  keywords: z.array(z.string()),
  gateTranscript: z.string().nullable(),
  transcript: z.string().nullable(),
  matchRatio: z.number().nullable(),
  keywordsOk: z.boolean().nullable(),
  intentOk: z.boolean().nullable(),
  wavSec: z.number(),
  wavBytes: z.number(),
  recordedMime: z.string().nullable(),
  source: z.enum(['BROWSER', 'TYPED_FALLBACK', 'MOCK']),
  listen: z.enum(['PLAYED', 'NO_VOICE', 'ERROR']).nullable(),
  speaker: z.enum(['PLAYED', 'FAILED', 'SKIPPED']).nullable(),
  gateRatio: z.number().nullable(),
});
const GenerationJson = z.object({
  providerId: z.string(),
  degraded: z.boolean(),
  fallbackFrom: z.string().nullable(),
  candidates: z.number(),
  elapsedMs: z.number(),
  source: z.enum(['PREPARED', 'LIVE']),
  intentName: z.string(),
});
export const FullPlanJson = z.object({
  voiceInput: z.enum(['off', 'real', 'mock']),
  sttDevice: z.enum(['cuda', 'cpu']).nullable(),
  sttModel: z.string().nullable(),
  sttRequested: z.enum(['auto', 'cuda', 'cpu']),
  localLlm: z.boolean(),
  liveClustering: z.boolean(),
  voiceOmittedReason: z.string().nullable(),
  llmOmittedReason: z.string().nullable(),
  deviceNote: z.object({ kind: z.enum(['SELECTED', 'FALLBACK']), reason: z.string() }).nullable(),
  gpuUse: z.enum(['none', 'stt', 'llm', 'both']),
  gpuUseText: z.string(),
  sceneCount: z.number(),
  totalBudgetSec: z.number(),
  /** 옵션으로 비활성된 단계(내부 사유 · 고객 사유 — 고객 사유가 null이면 고객 화면에 올리지 않는다). */
  inactive: z.array(z.object({ id: z.string(), reason: z.string(), customer: z.string().nullable() })),
  /** 고객용 "이 PC 구성에서 생략한 장면" 줄 · 활성 장면 이름 · 오늘 시연한 기능 번호(로드맵에서 제외). */
  omittedLines: z.array(z.string()),
  sceneTitles: z.array(z.string()),
  demonstratedNos: z.array(z.number()),
});
export type FullPlanJson = z.infer<typeof FullPlanJson>;
const ModelRowJson = z.object({
  role: z.enum(['embed', 'speech', 'augment']),
  port: z.number(),
  backend: z.string(),
  modelId: z.string(),
  device: z.string(),
  computeType: z.string().optional(),
  fallbackFrom: z.string().nullable().optional(),
  profile: z.string().optional(),
  targetCap: z.number().optional(),
  note: z.string().optional(),
});
const VramRowJson = z.object({ at: z.string(), event: z.string(), usedMiB: z.number().nullable(), totalMiB: z.number().nullable() });

export const ResultSchema = z.object({
  schemaVersion: z.literal(RESULT_SCHEMA_VERSION),
  tool: z.literal('DT-1'),
  runId: z.string(),
  preset: z.string(),
  mode: z.enum(['visible', 'headless-check']),
  status: z.enum(['PASSED', 'FAILED', 'ABORTED', 'PREPARE_FAILED']),
  exitCode: z.number().int(),
  commit: z.object({ sha: z.string().nullable(), dirty: z.boolean().nullable() }),
  startedAt: z.string(),
  showStartedAt: z.string().nullable(),
  endedAt: z.string(),
  durations: z.object({ prepareSec: z.number(), showSec: z.number(), pausedSec: z.number() }),
  machine: z.object({
    os: z.string(),
    cpu: z.string(),
    cores: z.number(),
    ramGb: z.number(),
    freeRamGb: z.number(),
    gpu: z.string(),
    /** [DT-2] 풀 투어에서 GPU를 쓰면 true(10분판은 항상 false — 값·키 집합 불변). */
    gpuUsedByHarness: z.boolean(),
  }),
  browser: z.object({ kind: z.string(), version: z.string().nullable(), playwright: z.string(), video: z.boolean() }),
  embeddingLatency: z
    .object({
      samples: z.number(),
      p50Ms: z.number(),
      p95Ms: z.number(),
      decidedTimeoutMs: z.number(),
      source: z.enum(['measured', 'manual']),
      rounds: z.array(z.object({ p50Ms: z.number(), p95Ms: z.number() })),
    })
    .nullable(),
  overrides: z.array(z.object({ key: z.string(), value: z.string(), default: z.string(), reason: z.string() })),
  egressChecklist: z.array(
    z.object({
      item: z.string(),
      state: z.enum(['UNSET', 'LOOPBACK', 'OFF', 'ON', 'BLOCKED', 'OPEN', 'UNKNOWN']),
      /** 칸 이름(서버 출구 키 · 증강 공급자 · 거버넌스 · ml-worker · 개발자 .env · 브라우저 · 네트워크 · 바인드 주의). */
      column: z.string().optional(),
      evidence: z.string().optional(),
    }),
  ),
  browserBlockedRequests: z.array(z.object({ host: z.string(), count: z.number(), firstStepId: z.string().nullable() })),
  network: z.object({ offline: z.boolean().nullable(), checkedAt: z.string().nullable() }),
  honesty: z.array(z.object({ stepId: z.string().nullable(), kind: HonestyKind, text: z.string() })),
  dataset: z.object({ historicalLogs: z.number(), accounts: z.number(), chatbots: z.number() }).nullable(),
  segments: z.array(z.object({ key: z.string(), title: z.string().optional(), budgetSec: z.number(), actualSec: z.number(), status: z.enum(['PASSED', 'FAILED', 'SKIPPED', 'NOT_RUN']) })),
  steps: z.array(StepResultSchema),
  appendix: z.object({ llm: z.null() }),
  teardown: z.object({ processesLeft: z.number(), portsFreed: z.boolean(), devDbUnchanged: z.boolean() }),

  // ── 선택 필드(보고서 절 · 재개 · 부가 정보) ──
  prepare: z.array(z.object({ id: z.string(), name: z.string(), sec: z.number(), status: z.enum(['OK', 'SKIPPED', 'FAILED']) })).optional(),
  /** 준비 단계에서 실패했다면 그 단계(재개 불가 — 새 실행 안내). */
  prepareFailure: z.object({ phase: z.string(), message: z.string(), why: z.string().optional(), how: z.string().optional() }).optional(),
  calibration: z.array(z.object({ id: z.string(), scene: z.string(), ok: z.boolean(), detail: z.string() })).optional(),
  roadmap: z.array(z.object({ featureNo: z.number(), name: z.string(), why: z.string(), status: z.string() })).optional(),
  media: z
    .object({
      video: z.string().nullable(),
      videoReason: z.string().nullable(),
      vtt: z.string().nullable(),
      gifs: z.array(z.string()),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  liveSchedule: z.object({ status: z.string(), scheduledAt: z.string().optional(), finalStatus: z.string().optional(), error: z.string().optional() }).optional(),
  governance: z.object({ mode: z.enum(['ON', 'OFF']), fallback: z.boolean(), logLine: z.string().nullable() }).optional(),
  envKeyNames: z.object({ blockedApi: z.array(z.string()), blockedMlWorker: z.array(z.string()), removedByPreload: z.array(z.string()) }).optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  customerCopy: z.boolean().optional(),

  // ── [DT-2] 풀 투어 선택 필드 ──
  plan: FullPlanJson.optional(),
  models: z.array(ModelRowJson).optional(),
  vram: z.array(VramRowJson).optional(),
  /** 구간별 GPU 메모리 최대(관찰값). */
  vramMax: z.array(z.object({ label: z.string(), usedMiB: z.number().nullable() })).optional(),
  speech: SpeechJson.nullable().optional(),
  localLlm: z.object({ prepared: GenerationJson.nullable(), live: GenerationJson.nullable(), loadMs: z.number().nullable(), unloaded: z.boolean().nullable() }).nullable().optional(),
  downloads: z.array(z.object({ stepId: z.string(), file: z.string(), bytes: z.number(), via: z.enum(['BROWSER', 'API']), auditRows: z.number().nullable(), signature: z.string() })).optional(),
  proactive: z.object({ shown: z.number(), clicked: z.number(), optedOut: z.number() }).nullable().optional(),
  /** 배지 표시 내역(내부판) — 표시하지 않은 배지와 이유. */
  badgeNotes: z.array(z.object({ stepId: z.string(), shown: z.array(z.string()), hidden: z.array(z.object({ badge: z.string(), why: z.string() })) })).optional(),
  /** 음성 원본 저장 0 확인(매직 바이트 휴리스틱 — 설계 S-DX-1). */
  audioStoreCheck: z.object({ scannedFiles: z.number(), hits: z.array(z.string()), logHits: z.array(z.string()) }).optional(),
  /** 풀 투어 gates(G-DX-1~4) — calibration 목록에도 함께 실린다. */
  childOverrides: z.array(z.object({ key: z.string(), value: z.string(), default: z.string(), reason: z.string() })).optional(),
});
export type ResultJson = z.infer<typeof ResultSchema>;

/** result.json 문자열을 읽어 검증한다(왕복 시험 · 기계 판정용). */
export function parseResult(text: string): ResultJson {
  return ResultSchema.parse(JSON.parse(text));
}
