import { z } from 'zod';
import { PaginationQuerySchema, SafeUrlSchema, SortOrder, csvEnumArray } from './common';

/** 기능요구사항.md No.1 챗봇 리스트/그룹 관리 */
export const ChatbotGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ChatbotGroup = z.infer<typeof ChatbotGroupSchema>;

export const CreateChatbotGroupSchema = ChatbotGroupSchema.pick({ name: true, description: true });
export type CreateChatbotGroupDto = z.infer<typeof CreateChatbotGroupSchema>;

/** 그룹 수정(FR-1-4). description은 명시적 null로 삭제 가능(D-10). */
export const UpdateChatbotGroupSchema = CreateChatbotGroupSchema.partial().extend({
  description: z.string().max(500).nullable().optional(),
});
export type UpdateChatbotGroupDto = z.infer<typeof UpdateChatbotGroupSchema>;

/** 그룹 목록/단건 응답 — 소속 챗봇 수 포함(FR-1-2). */
export const ChatbotGroupWithCountSchema = ChatbotGroupSchema.extend({
  chatbotCount: z.number().int().nonnegative(),
});
export type ChatbotGroupWithCount = z.infer<typeof ChatbotGroupWithCountSchema>;

/** 그룹 복사 요청(FR-1-7). name 미지정 시 "{원본명} (사본)" 자동 생성. */
export const CopyChatbotGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type CopyChatbotGroupDto = z.infer<typeof CopyChatbotGroupSchema>;

export const ChatbotStatus = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ChatbotStatus = z.infer<typeof ChatbotStatus>;

/** 허용된 상태 전이표(FR-1-17, AC-1-13). FE/BE 공용 — 버튼 비활성 판단에도 사용. */
export const CHATBOT_STATUS_TRANSITIONS: Record<ChatbotStatus, ChatbotStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

/** slug 예약어(FR-3-6). */
export const RESERVED_SLUGS = [
  'api',
  'admin',
  'www',
  'health',
  'static',
  'assets',
  'widget',
  'new',
  'edit',
] as const;

/** slug 형식(3~50자, 소문자/숫자/하이픈) + 예약어 금지(FR-3-5, FR-3-6). */
export const SlugSchema = z
  .string()
  .min(3, '3자 이상 입력해 주세요.')
  .max(50, '50자 이하로 입력해 주세요.')
  .regex(/^[a-z0-9-]+$/, '소문자/숫자/하이픈만 사용할 수 있습니다.')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
    message: '사용할 수 없는 예약어입니다.',
  });

/** 스킨/임베드 설정(No.4). 색상/테마 토큰만 다루고 실제 CSS는 프론트에서 렌더링한다. */
export const ChatbotSkinSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB 형식의 6자리 색상 코드만 사용할 수 있습니다.')
    .default('#4F46E5'),
  headerTitle: z.string().max(50, '50자 이하로 입력해 주세요.').default('챗봇 상담'),
  logoUrl: SafeUrlSchema.optional(),
});
export type ChatbotSkin = z.infer<typeof ChatbotSkinSchema>;

/** 스킨 기본값(FR-1-8, AC-4-6). Prisma 컬럼 기본값 문자열과 동일한 값을 참조한다. */
export const DEFAULT_CHATBOT_SKIN: { primaryColor: string; headerTitle: string } = {
  primaryColor: '#4F46E5',
  headerTitle: '챗봇 상담',
};

/** 기능요구사항.md No.1(그룹 소속) / No.3(기본설정) / No.4(스킨/임베드) 통합 엔터티 */
export const ChatbotSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(100),
  avatarUrl: SafeUrlSchema.optional(),
  description: z.string().max(500).optional(),
  /** 고유 URL(No.3 기본설정) — 임베드/배포 시 사용 */
  slug: SlugSchema,
  status: ChatbotStatus.default('DRAFT'),
  skin: ChatbotSkinSchema.default({ primaryColor: '#4F46E5', headerTitle: '챗봇 상담' }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Chatbot = z.infer<typeof ChatbotSchema>;

export const CreateChatbotSchema = ChatbotSchema.pick({
  groupId: true,
  name: true,
  avatarUrl: true,
  description: true,
  slug: true,
}).partial({ avatarUrl: true, description: true });
export type CreateChatbotDto = z.infer<typeof CreateChatbotSchema>;

/**
 * 챗봇 기본설정 부분 수정(FR-3-1). 부분 수정 시맨틱(D-10):
 * 키 없음/undefined = 미변경, null = 값 삭제(avatarUrl/description만 허용), 값 = 교체.
 * name/slug는 필수 성격이라 null을 허용하지 않는다.
 */
export const UpdateChatbotSettingsSchema = ChatbotSchema.pick({
  name: true,
  avatarUrl: true,
  description: true,
  slug: true,
})
  .partial()
  .extend({
    avatarUrl: SafeUrlSchema.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  });
export type UpdateChatbotSettingsDto = z.infer<typeof UpdateChatbotSettingsSchema>;

/** 스킨 부분 수정(FR-4-1). logoUrl만 null로 명시 삭제 가능(FR-4-7 기본값 되돌리기). */
export const UpdateChatbotSkinSchema = ChatbotSkinSchema.partial().extend({
  logoUrl: SafeUrlSchema.nullable().optional(),
});
export type UpdateChatbotSkinDto = z.infer<typeof UpdateChatbotSkinSchema>;

/** 챗봇 목록 쿼리(FR-1-9, FR-1-10, FR-0-5). */
export const ChatbotListQuerySchema = PaginationQuerySchema.extend({
  groupId: z.string().uuid().optional(),
  status: csvEnumArray(ChatbotStatus),
  q: z.string().max(100).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name']).default('updatedAt'),
  order: SortOrder.default('desc'),
  includeArchived: z.coerce.boolean().default(false),
});
export type ChatbotListQuery = z.infer<typeof ChatbotListQuerySchema>;

/** 챗봇 목록 행 — 소속 그룹명 포함(FR-1-11). */
export const ChatbotListItemSchema = ChatbotSchema.extend({
  groupName: z.string(),
});
export type ChatbotListItem = z.infer<typeof ChatbotListItemSchema>;

/** 챗봇 복사 요청(FR-1-13). 미지정 필드는 자동 파생 규칙을 따른다. */
export const CopyChatbotSchema = z.object({
  targetGroupId: z.string().uuid().optional(),
  name: z.string().min(1).max(100).optional(),
  slug: SlugSchema.optional(),
});
export type CopyChatbotDto = z.infer<typeof CopyChatbotSchema>;

/** 상태 전환 요청(FR-1-17). */
export const UpdateChatbotStatusSchema = z.object({
  status: ChatbotStatus,
});
export type UpdateChatbotStatusDto = z.infer<typeof UpdateChatbotStatusSchema>;

/** 그룹 이동 요청(FR-1-12). */
export const MoveChatbotGroupSchema = z.object({
  groupId: z.string().uuid(),
});
export type MoveChatbotGroupDto = z.infer<typeof MoveChatbotGroupSchema>;

/** 영구 삭제 확인(FR-1-15(b), D-9). 서버가 챗봇 이름과 일치 여부를 재검증한다. */
export const PermanentDeleteChatbotSchema = z.object({
  confirmName: z.string().min(1),
});
export type PermanentDeleteChatbotDto = z.infer<typeof PermanentDeleteChatbotSchema>;

/** slug 실시간 중복 확인 요청(FR-3-7). raw string — 형식 위반도 400이 아니라 reason:'FORMAT'으로 응답. */
export const SlugAvailabilityQuerySchema = z.object({
  slug: z.string().min(1),
  excludeChatbotId: z.string().uuid().optional(),
});
export type SlugAvailabilityQuery = z.infer<typeof SlugAvailabilityQuerySchema>;

export const SlugAvailabilityReason = z.enum(['FORMAT', 'RESERVED', 'TAKEN']);
export type SlugAvailabilityReason = z.infer<typeof SlugAvailabilityReason>;

export const SlugAvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  reason: SlugAvailabilityReason.optional(),
  message: z.string(),
});
export type SlugAvailability = z.infer<typeof SlugAvailabilitySchema>;

/**
 * [신규 2026-09-23 No.25] 챗봇 버전 스냅샷의 표시 설정 4필드(ADR-0031 §1, P-2). 원본과 같은 파일에
 * 파생 스키마를 둔다(개발명세서 §6-9). `avatarUrl`/`description`은 `ChatbotSchema`의 `.optional()`과
 * 달리 스냅샷 저장 형식에서는 "값 없음"을 `null`로 명시한다(§5.1 — undefined는 직렬화에서 생략된다).
 */
export const ChatbotSnapshotProfileSchema = ChatbotSchema.pick({ name: true, avatarUrl: true, description: true, skin: true }).extend({
  avatarUrl: SafeUrlSchema.nullable(),
  description: z.string().max(500).nullable(),
});
export type ChatbotSnapshotProfile = z.infer<typeof ChatbotSnapshotProfileSchema>;

/** 임베드 코드 응답(FR-4-9, FR-4-14). 조회 시점에 생성되며 DB에 저장하지 않는다. */
export const EmbedCodeSchema = z.object({
  pc: z.string(),
  mobile: z.string(),
  publicUrl: z.string(),
  scriptUrl: z.string(),
});
export type EmbedCode = z.infer<typeof EmbedCodeSchema>;
