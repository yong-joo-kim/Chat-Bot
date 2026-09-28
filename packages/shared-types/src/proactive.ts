import { z } from 'zod';
import { PublicChatbotConfigSchema } from './conversation';
import { inspectRichUrl, RICH_URL_ERROR_MESSAGES } from './rich-url';

/**
 * [신규 No.35] 선제적(Proactive) 메시징 — 규칙·설정·공개 페이로드·수집 사건·통계·목록 zod 계약
 * (`proactive-messaging-설계.md` §4.1 · ADR-0045). 판정 순수 함수(경로 매칭·게이트 등)는 **이 파일이
 * 아니라** zod 무의존 서브패스 `./proactive-eval`에 있다(NFR-PAM1 — 위젯이 zod를 반입하지 않도록).
 */

export const PROACTIVE_LIMITS = {
  rulesMax: 20,
  enabledRulesMax: 10,
  nameMax: 40,
  textMax: 120,
  textMaxNewlines: 2,
  buttonsMax: 3,
  buttonLabelMax: 20,
  messageTextMax: 200,
  pathPatternsIncludeMax: 10,
  pathPatternsExcludeMax: 10,
  pathPatternMax: 200,
  pathPatternDoubleStarMax: 2,
  dwellSecMin: 5,
  dwellSecMax: 600,
  dwellSecDefault: 30,
  maxPerSessionMin: 1,
  maxPerSessionMax: 3,
  maxPerSessionDefault: 1,
  minIntervalSecMin: 30,
  minIntervalSecMax: 600,
  minIntervalSecDefault: 60,
  quietAfterUserMessageSecMin: 60,
  quietAfterUserMessageSecMax: 1800,
  quietAfterUserMessageSecDefault: 300,
  statsRangeDaysMax: 90,
  statsRangeDaysDefault: 7,
  frequentDismiss: { ratio: 0.5, minShown: 100 },
} as const;

/** 1차 유일값. 2차(`HOST_SIGNAL`·`UNANSWERED_STREAK`) 추가 시 이 enum · 판별 유니온 분기 ·
 * `PROACTIVE_WIDGET_TRIGGER_KINDS` 3곳을 함께 고친다(NFR-PAM4). */
export const ProactiveTriggerKind = z.enum(['PAGE_DWELL']);
export type ProactiveTriggerKind = z.infer<typeof ProactiveTriggerKind>;

/** 공개 조회가 내려보내는(위젯이 판정 가능한) 트리거 종류의 닫힌 목록(§5.2 ③). */
export const PROACTIVE_WIDGET_TRIGGER_KINDS: readonly ProactiveTriggerKind[] = ['PAGE_DWELL'];

const SEGMENT_LITERAL_RE = /^[^\s?#*]+$/;

function isValidPathSegment(segment: string): boolean {
  return segment === '*' || segment === '**' || SEGMENT_LITERAL_RE.test(segment);
}

/** 패턴 문법 검사 + 정규화(끝 `/` 제거 — `/`만 예외). 실패하면 `ok:false`. */
function analyzeProactivePathPattern(raw: string): { ok: true; normalized: string } | { ok: false } {
  if (raw.length < 1 || raw.length > PROACTIVE_LIMITS.pathPatternMax) return { ok: false };
  if (!raw.startsWith('/')) return { ok: false };
  const normalized = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (normalized === '/') return { ok: true, normalized };

  const segments = normalized.slice(1).split('/');
  let doubleStarCount = 0;
  for (const seg of segments) {
    if (seg.length === 0) return { ok: false }; // 연속 / 불허
    if (seg === '**') doubleStarCount += 1;
    if (!isValidPathSegment(seg)) return { ok: false };
  }
  if (doubleStarCount > PROACTIVE_LIMITS.pathPatternDoubleStarMax) return { ok: false };
  return { ok: true, normalized };
}

/**
 * FR-PA2-1 — 경로만(스킴·호스트·쿼리·해시 제외) · `*`(1세그먼트)·`**`(0개 이상)만 허용(정규식 패턴
 * 자체는 거부, ReDoS 방지) · `**` ≤2 · 연속 `/` 불허 · 끝 `/` 제거 정규화.
 */
export const ProactivePathPatternSchema = z
  .string()
  .min(1)
  .max(PROACTIVE_LIMITS.pathPatternMax)
  .superRefine((v, ctx) => {
    const trimmed = v.trim();
    if (!analyzeProactivePathPattern(trimmed).ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '경로는 /로 시작하고 *·**·일반 문자만 사용할 수 있습니다(**는 최대 2개, 연속 /는 불가합니다).',
      });
    }
  })
  .transform((v) => {
    const trimmed = v.trim();
    const r = analyzeProactivePathPattern(trimmed);
    return r.ok ? r.normalized : trimmed;
  });

export const ProactivePageDwellTriggerSchema = z
  .object({
    kind: z.literal('PAGE_DWELL'),
    pathInclude: z.array(ProactivePathPatternSchema).min(1).max(PROACTIVE_LIMITS.pathPatternsIncludeMax),
    pathExclude: z.array(ProactivePathPatternSchema).max(PROACTIVE_LIMITS.pathPatternsExcludeMax).default([]),
    dwellSec: z.number().int().min(PROACTIVE_LIMITS.dwellSecMin).max(PROACTIVE_LIMITS.dwellSecMax),
  })
  .strict();
export type ProactivePageDwellTrigger = z.infer<typeof ProactivePageDwellTriggerSchema>;

/** 판별 유니온 — 1차 분기는 `PAGE_DWELL` 하나(P-2 축소, R-1). */
export const ProactiveTriggerSchema = z.discriminatedUnion('kind', [ProactivePageDwellTriggerSchema]);
export type ProactiveTrigger = z.infer<typeof ProactiveTriggerSchema>;

/**
 * 기존 `ButtonItemSchema`(`dialogue.ts`)와 같은 형식(`{ label, action, value }`) + 선제 전용 제약:
 * 라벨 ≤20자(빠른 선택 라벨 상한과 같음) · `MESSAGE` 값 ≤200자 · `NODE` 값 uuid · `LINK`는
 * `RichButtonItemSchema`와 같은 `inspectRichUrl`(https·위험 형식 차단, FR-PA1-6).
 */
export const ProactiveButtonSchema = z
  .object({
    label: z.string().trim().min(1).max(PROACTIVE_LIMITS.buttonLabelMax),
    action: z.enum(['NODE', 'MESSAGE', 'LINK']),
    value: z.string().min(1),
  })
  .superRefine((btn, ctx) => {
    if (btn.action === 'NODE' && !z.string().uuid().safeParse(btn.value).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '이동할 노드를 선택해 주세요.', path: ['value'] });
    }
    if (btn.action === 'MESSAGE' && btn.value.length > PROACTIVE_LIMITS.messageTextMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `버튼 메시지는 최대 ${PROACTIVE_LIMITS.messageTextMax}자까지 입력할 수 있습니다.`,
        path: ['value'],
      });
    }
    if (btn.action === 'LINK') {
      const r = inspectRichUrl(btn.value);
      if (!r.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: RICH_URL_ERROR_MESSAGES[r.error], path: ['value'] });
      }
    }
  });
export type ProactiveButton = z.infer<typeof ProactiveButtonSchema>;

export const ProactiveDevice = z.enum(['DESKTOP', 'MOBILE']);
export type ProactiveDevice = z.infer<typeof ProactiveDevice>;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 표시 시간대(선택) — 요일 체계는 `toKstWeekday()`(0=월~6=일, R-14). 자정 넘김 불허(1차). */
export const ProactiveScheduleSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: z.string().regex(HHMM_RE, 'HH:mm 형식으로 입력해 주세요.'),
    to: z.string().regex(HHMM_RE, 'HH:mm 형식으로 입력해 주세요.'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.days).size !== v.days.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '요일은 중복 없이 선택해 주세요.', path: ['days'] });
    }
    if (v.from >= v.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '시작 시각은 종료 시각보다 빨라야 합니다.', path: ['to'] });
    }
  });
export type ProactiveSchedule = z.infer<typeof ProactiveScheduleSchema>;

/** 생성·수정 공용 입력(`.strict()`) — `enabled`·`position`은 받지 않는다(생성 = 꺼짐·맨 뒤,
 * 켜기/이동은 별도 경로, §9.1). */
export const ProactiveRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(PROACTIVE_LIMITS.nameMax),
    trigger: ProactiveTriggerSchema,
    text: z
      .string()
      .min(1)
      .max(PROACTIVE_LIMITS.textMax)
      .superRefine((v, ctx) => {
        const newlineCount = (v.match(/\n/g) ?? []).length;
        if (newlineCount > PROACTIVE_LIMITS.textMaxNewlines) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `줄바꿈은 최대 ${PROACTIVE_LIMITS.textMaxNewlines}번까지 가능합니다.` });
        }
        if (/\{[^{}]*\}/.test(v)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: '문구에는 치환 형태({ })를 쓸 수 없습니다(정적 텍스트만).' });
        }
      }),
    buttons: z.array(ProactiveButtonSchema).max(PROACTIVE_LIMITS.buttonsMax).default([]),
    devices: z.array(ProactiveDevice).min(1).max(2).default(['DESKTOP']),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    schedule: ProactiveScheduleSchema.nullable().optional(),
    /** "이 안내는 광고·판촉 목적이 아닙니다" 확인 — 생성·수정마다 필수(FR-PA1-8). */
    purposeConfirmed: z.literal(true),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.startsAt && val.endsAt && val.startsAt.getTime() >= val.endsAt.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '게시 시작 시각은 종료 시각보다 빨라야 합니다.', path: ['endsAt'] });
    }
    if (new Set(val.devices).size !== val.devices.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '기기는 중복 없이 선택해 주세요.', path: ['devices'] });
    }
  });
export type ProactiveRuleInput = z.infer<typeof ProactiveRuleInputSchema>;

export const ProactiveSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    maxPerSession: z.number().int().min(PROACTIVE_LIMITS.maxPerSessionMin).max(PROACTIVE_LIMITS.maxPerSessionMax),
    minIntervalSec: z.number().int().min(PROACTIVE_LIMITS.minIntervalSecMin).max(PROACTIVE_LIMITS.minIntervalSecMax),
    quietAfterUserMessageSec: z.number().int().min(PROACTIVE_LIMITS.quietAfterUserMessageSecMin).max(PROACTIVE_LIMITS.quietAfterUserMessageSecMax),
  })
  .strict();
export type ProactiveSettingsInput = z.infer<typeof ProactiveSettingsInputSchema>;

export const MoveProactiveRuleSchema = z.object({ direction: z.enum(['UP', 'DOWN']) }).strict();
export type MoveProactiveRuleDto = z.infer<typeof MoveProactiveRuleSchema>;

export const ProactiveRuleIssue = z.enum(['TARGET_UNAVAILABLE', 'SERVING_UNVERIFIABLE', 'BANNED_WORD', 'LINK_OUTSIDE_POLICY', 'INVALID_STORED']);
export type ProactiveRuleIssue = z.infer<typeof ProactiveRuleIssue>;

export const ProactiveRuleWarning = z.enum(['CONTACT_LIKE']);
export type ProactiveRuleWarning = z.infer<typeof ProactiveRuleWarning>;

export const ProactivePeriodState = z.enum(['ALWAYS', 'SCHEDULED', 'ACTIVE', 'ENDED']);
export type ProactivePeriodState = z.infer<typeof ProactivePeriodState>;

export const ProactiveRuleViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  position: z.number().int(),
  trigger: ProactiveTriggerSchema,
  text: z.string(),
  buttons: z.array(ProactiveButtonSchema),
  devices: z.array(ProactiveDevice),
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  schedule: ProactiveScheduleSchema.nullable(),
  periodState: ProactivePeriodState,
  issues: z.array(ProactiveRuleIssue),
  warnings: z.array(ProactiveRuleWarning),
  last7d: z.object({
    shown: z.number().int().nonnegative(),
    clicked: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    optedOut: z.number().int().nonnegative(),
  }),
  frequentlyDismissed: z.boolean(),
  purposeConfirmedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProactiveRuleView = z.infer<typeof ProactiveRuleViewSchema>;

export const ProactiveOverviewResponseSchema = z.object({
  settings: z.object({
    enabled: z.boolean(),
    maxPerSession: z.number().int(),
    minIntervalSec: z.number().int(),
    quietAfterUserMessageSec: z.number().int(),
    updatedAt: z.coerce.date().nullable(),
  }),
  /** `PROACTIVE_ENABLED` 환경변수(§3.5) — false면 관리 API는 동작하되 공개 조회는 항상 빈 규칙이다. */
  serverEnabled: z.boolean(),
  context: z.object({
    chatbotStatus: z.string(),
    webChannelEnabled: z.boolean(),
    launcherHidden: z.boolean(),
    environmentMode: z.boolean(),
  }),
  limits: z.object({ rulesMax: z.number().int(), enabledRulesMax: z.number().int() }),
  rules: z.array(ProactiveRuleViewSchema),
});
export type ProactiveOverviewResponse = z.infer<typeof ProactiveOverviewResponseSchema>;

const DAY_BUCKET_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ProactiveStatsQuerySchema = z
  .object({
    from: z.string().regex(DAY_BUCKET_RE, 'YYYY-MM-DD 형식으로 입력해 주세요.').optional(),
    to: z.string().regex(DAY_BUCKET_RE, 'YYYY-MM-DD 형식으로 입력해 주세요.').optional(),
  })
  .strict();
export type ProactiveStatsQuery = z.infer<typeof ProactiveStatsQuerySchema>;

const ProactiveStatsTotalSchema = z.object({
  ruleId: z.string(),
  name: z.string(),
  deleted: z.boolean(),
  shown: z.number().int().nonnegative(),
  clicked: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  optedOut: z.number().int().nonnegative(),
  clickRate: z.number().nullable(),
  dismissRate: z.number().nullable(),
  optOutRate: z.number().nullable(),
  frequentlyDismissed: z.boolean(),
});

const ProactiveStatsDailySchema = z.object({
  day: z.string(),
  ruleId: z.string(),
  shown: z.number().int().nonnegative(),
  clicked: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  optedOut: z.number().int().nonnegative(),
});

export const ProactiveStatsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** "브라우저 보고 기반 참고치" 상시 고지의 원천(FR-PA6-4). */
  basis: z.literal('BROWSER_REPORTED'),
  frequentDismiss: z.object({ ratio: z.number(), minShown: z.number().int() }),
  totals: z.array(ProactiveStatsTotalSchema),
  daily: z.array(ProactiveStatsDailySchema),
});
export type ProactiveStatsResponse = z.infer<typeof ProactiveStatsResponseSchema>;

/**
 * 공개 규칙(`.strict()`) — 이름·순서·기간 원본·시간대·수정자·통계·용도 확인 키가 **존재할 수 없다**
 * (PA-5, NFR-PAS2).
 */
export const PublicProactiveRuleSchema = z
  .object({
    id: z.string().uuid(),
    trigger: ProactiveTriggerSchema,
    text: z.string(),
    buttons: z.array(ProactiveButtonSchema),
    devices: z.array(ProactiveDevice),
    showUntil: z.coerce.date().optional(),
  })
  .strict();
export type PublicProactiveRule = z.infer<typeof PublicProactiveRuleSchema>;

export const PublicProactivePayloadSchema = z
  .object({
    caps: z.object({
      maxPerSession: z.number().int(),
      minIntervalSec: z.number().int(),
      quietAfterUserMessageSec: z.number().int(),
    }),
    rules: z.array(PublicProactiveRuleSchema),
  })
  .strict();
export type PublicProactivePayload = z.infer<typeof PublicProactivePayloadSchema>;

/** `GET /public/chatbots/:slug/config?proactive=1` 응답 — 기존 `PublicChatbotConfigSchema`는
 * **수정하지 않는다**(바이트 동일 보장, §5.1). */
export const PublicChatbotConfigWithProactiveSchema = PublicChatbotConfigSchema.extend({
  proactive: PublicProactivePayloadSchema.optional(),
});
export type PublicChatbotConfigWithProactive = z.infer<typeof PublicChatbotConfigWithProactiveSchema>;

export const ProactiveEventKind = z.enum(['SHOWN', 'CLICKED', 'DISMISSED', 'OPTED_OUT']);
export type ProactiveEventKind = z.infer<typeof ProactiveEventKind>;

/** `POST /public/chatbots/:slug/proactive-events` 본문(`.strict()`) — 주소·체류·리퍼러·신호 이름
 * 필드가 **없다**(AC-PA5-2 · FR-PA5-3). */
export const PublicProactiveEventSchema = z
  .object({
    sessionId: z.string().uuid(),
    ruleId: z.string().uuid(),
    kind: ProactiveEventKind,
  })
  .strict();
export type PublicProactiveEventDto = z.infer<typeof PublicProactiveEventSchema>;

/** 콘솔 노드 삭제 경고용 순수 함수 — `buttons[].action === 'NODE' && value === nodeId`인 규칙을
 * 고른다(대화 설계 API·`reference-check.service.ts` 변경 0, R-9). */
export function findProactiveRulesReferencingNode(
  rules: readonly { id: string; name: string; buttons: readonly { action: string; value: string }[] }[],
  nodeId: string,
): { id: string; name: string }[] {
  return rules.filter((r) => r.buttons.some((b) => b.action === 'NODE' && b.value === nodeId)).map((r) => ({ id: r.id, name: r.name }));
}
