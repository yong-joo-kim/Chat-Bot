import { z } from 'zod';
import { HANDOFF_SESSION_HEADER } from './conversation';
import { PublicChatbotConfigWithProactiveSchema } from './proactive';
import { SPEECH_TONES } from './speech-voice';

/**
 * [신규 No.32] 음성 AI(눌러서 말하기 + 답변 듣기) 계약 — 서버·콘솔 공용(voice-ai-설계.md §4.1, ADR-0052).
 * 위젯이 쓰는 말투 대응표·읽기 보조 함수는 zod 무의존 서브패스 `./speech-voice`에 있다(위젯이 zod를 반입하지 않도록).
 *
 * 이름 규칙: `voice` = 제품 기능·설정(관리 경로·공개 설정 키·콘솔) · `speech` = 기술 구성요소(응답 키·공개 경로·출구).
 */

export const SPEECH_LIMITS = {
  maxRecordSeconds: 30,
  uploadDeadlineMs: 15000,
  transcriptMaxChars: 2000,
  speechTextMaxChars: 2000,
  speechTextTail: '나머지는 화면에서 확인해 주세요.',
  nodeTonesMax: 200,
  rateMultiplier: { min: 0.8, max: 1.2, step: 0.05 },
  statsRangeDaysMax: 90,
  statsRangeDaysDefault: 7,
  voicesWaitMs: 2000,
  previewTextMax: 200,
} as const;

/** 새 헤더 이름을 만들지 않는다 — 상담 세션 헤더의 별칭(CORS·프록시 설정 변경 0, DD-120). */
export const SPEECH_SESSION_HEADER = HANDOFF_SESSION_HEADER;

export const SpeechToneSchema = z.enum(SPEECH_TONES);

/** 읽기 대상 봇 답변 종류 3종(H-3 · DD-136). 시스템 안내·상담 응답은 종류 자체가 없다(= `speech` 키 없음). */
export const SpeechResponseKind = z.enum(['ANSWERED', 'UNANSWERED', 'SAFETY']);
export type SpeechResponseKind = z.infer<typeof SpeechResponseKind>;

/** 관리자가 종류별로 지정할 수 있는 것은 `UNANSWERED` 1개뿐 — `ANSWERED`는 `defaultTone`, `SAFETY`는 고정(CALM).
 * 모르는 키(예전 초안의 `BLOCKED`·`ERROR` 등)는 `.strict()`로 저장을 거부한다. */
export const VoiceToneByKindSchema = z.object({ UNANSWERED: SpeechToneSchema.optional() }).strict();
export type VoiceToneByKind = z.infer<typeof VoiceToneByKindSchema>;

export const VoiceNodeToneSchema = z.object({ nodeId: z.string().uuid(), tone: SpeechToneSchema }).strict();
export type VoiceNodeTone = z.infer<typeof VoiceNodeToneSchema>;

const RATE_STEP_SCALE = 100; // 0.05 단위 = 5/100 — 부동소수 오차 없이 배수 검사.

const rateMultiplierField = z
  .number()
  .min(SPEECH_LIMITS.rateMultiplier.min, '0.8~1.2 사이로 입력하세요.')
  .max(SPEECH_LIMITS.rateMultiplier.max, '0.8~1.2 사이로 입력하세요.')
  .refine((v) => Math.abs(Math.round(v * RATE_STEP_SCALE) - v * RATE_STEP_SCALE) < 1e-6 && Math.round(v * RATE_STEP_SCALE) % 5 === 0, '0.05 단위로 입력하세요. (예: 0.95, 1.00, 1.05)');

/** `PUT /chatbots/:chatbotId/voice` — **전체 교체**(부분 병합 금지, 채널 설정 선례). */
export const VoiceSettingsInputSchema = z
  .object({
    inputEnabled: z.boolean(),
    ttsEnabled: z.boolean(),
    autoReadToggleVisible: z.boolean(),
    rateMultiplier: rateMultiplierField,
    defaultTone: SpeechToneSchema,
    toneByKind: VoiceToneByKindSchema,
    nodeTones: z
      .array(VoiceNodeToneSchema)
      .max(SPEECH_LIMITS.nodeTonesMax)
      .refine((rows) => new Set(rows.map((r) => r.nodeId)).size === rows.length, 'nodeId가 중복되었습니다.'),
  })
  .strict();
export type VoiceSettingsInput = z.infer<typeof VoiceSettingsInputSchema>;

export const VoiceNodeToneViewSchema = VoiceNodeToneSchema.extend({
  /** 조회 시점 초안 이름. */
  nodeName: z.string().nullable(),
  /** 노드가 삭제되어 없으면 `true`(없으면 키 생략). */
  nodeMissing: z.boolean().optional(),
}).strict();
export type VoiceNodeToneView = z.infer<typeof VoiceNodeToneViewSchema>;

export const VoiceSettingsViewSchema = z
  .object({
    inputEnabled: z.boolean(),
    ttsEnabled: z.boolean(),
    autoReadToggleVisible: z.boolean(),
    rateMultiplier: z.number(),
    defaultTone: SpeechToneSchema,
    toneByKind: VoiceToneByKindSchema,
    nodeTones: z.array(VoiceNodeToneViewSchema),
    /** 행 없음(= 전부 꺼짐 기본값) → `null`. */
    updatedAt: z.coerce.date().nullable(),
  })
  .strict();
export type VoiceSettingsView = z.infer<typeof VoiceSettingsViewSchema>;

export const VoiceServerProviderSchema = z.enum(['mock', 'local']);
export type VoiceServerProvider = z.infer<typeof VoiceServerProviderSchema>;

/** 모델 이름·장치·주소는 싣지 않는다(관리자에게도 — 운영 정보는 ml-worker `/speech/health`와 운영 문서). */
export const VoiceServerStatusSchema = z
  .object({
    enabled: z.boolean(),
    provider: VoiceServerProviderSchema,
    inputAvailable: z.boolean(),
    reason: z.enum(['SERVER_DISABLED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED']).optional(),
  })
  .strict();
export type VoiceServerStatus = z.infer<typeof VoiceServerStatusSchema>;

export const VoiceOverviewResponseSchema = z
  .object({
    settings: VoiceSettingsViewSchema,
    server: VoiceServerStatusSchema,
    context: z.object({ webChannelEnabled: z.boolean(), chatbotStatus: z.string() }).strict(),
    limits: z.object({ nodeTonesMax: z.number().int() }).strict(),
  })
  .strict();
export type VoiceOverviewResponse = z.infer<typeof VoiceOverviewResponseSchema>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /chatbots/:chatbotId/voice/stats?from=&to=` — KST 일 · 기본 최근 7일 · 범위 ≤ 90일(범위 검사는 서버). */
export const VoiceStatsQuerySchema = z
  .object({
    from: z.string().regex(DAY_RE, 'YYYY-MM-DD 형식으로 입력해 주세요.').optional(),
    to: z.string().regex(DAY_RE, 'YYYY-MM-DD 형식으로 입력해 주세요.').optional(),
  })
  .strict();
export type VoiceStatsQuery = z.infer<typeof VoiceStatsQuerySchema>;

const VoiceStatCountsShape = {
  requested: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  busy: z.number().int().nonnegative(),
};

export const VoiceStatsResponseSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    totals: z.object(VoiceStatCountsShape).strict(),
    /** 0인 날도 채운다. */
    daily: z.array(z.object({ day: z.string(), ...VoiceStatCountsShape }).strict()),
  })
  .strict();
export type VoiceStatsResponse = z.infer<typeof VoiceStatsResponseSchema>;

/** 공개 설정 `voice` 키 — **키 순서가 계약**(직렬화 순서 = 조립 순서). 입력·듣기 모두 거짓이면 키 자체가 없다. */
export const PublicVoiceConfigSchema = z
  .object({
    input: z.boolean(),
    tts: z.boolean(),
    autoReadToggle: z.boolean(),
    rate: z.number(),
  })
  .strict();
export type PublicVoiceConfig = z.infer<typeof PublicVoiceConfigSchema>;

/** `GET /public/chatbots/:slug/config` 응답 — 기존 두 스키마는 **수정하지 않는다**(No.35 선례, 바이트 동일 보장). */
export const PublicChatbotConfigResponseSchema = PublicChatbotConfigWithProactiveSchema.extend({
  voice: PublicVoiceConfigSchema.optional(),
});
export type PublicChatbotConfigResponse = z.infer<typeof PublicChatbotConfigResponseSchema>;

/** `POST /public/chatbots/:slug/speech/transcriptions` 응답. 말소리 없음 = `text:''` + `empty:true`.
 * `durationMs`는 디코딩된 녹음 길이이며 처리 시간이 아니다(H-9). */
export const PublicSpeechTranscriptionResponseSchema = z
  .object({
    text: z.string().max(SPEECH_LIMITS.transcriptMaxChars),
    durationMs: z.number().int().nonnegative(),
    empty: z.literal(true).optional(),
  })
  .strict();
export type PublicSpeechTranscriptionResponse = z.infer<typeof PublicSpeechTranscriptionResponseSchema>;

/** 음성 AI 신규 오류 코드 5종 — `ApiErrorCode`와 같은 값(공개 메시지는 내부 정보 0). */
export const SPEECH_ERROR_CODES = ['SPEECH_UNAVAILABLE', 'SPEECH_BUSY', 'SPEECH_AUDIO_INVALID', 'SPEECH_AUDIO_TOO_LARGE', 'SPEECH_FAILED'] as const;

/** 서버 전용 타입 — 대화 턴 1회의 말투 계획(§6.4). 글자가 아니라 말투 이름뿐이다. */
export interface SpeechReplyPlan {
  answeredTone: z.infer<typeof SpeechToneSchema>;
  unansweredTone: z.infer<typeof SpeechToneSchema>;
  nodeTones: ReadonlyMap<string, z.infer<typeof SpeechToneSchema>>;
}
