import { z } from 'zod';
import { PaginationQuerySchema, SortOrder, csvEnumArray, queryBoolean } from './common';

/**
 * No.12 회원·권한·보안 관리 (`security-audit-설계.md` §4.1, ADR-0014/0015).
 * 인증은 서버 보관 불투명 세션(httpOnly 쿠키) + Node 내장 `crypto.scrypt`다. `Role`/`Permission`
 * 테이블은 만들지 않는다 — 역할 3종 고정 + 역할→권한 매핑은 이 파일의 코드 상수가 단일 소스다(J-6).
 */

/* ── 역할 ── [신규 2026-09-25 No.24] `AGENT`(상담원) — 3 → 4종(ADR-0036 §7). 기존 3종 인덱스 불변. */
export const RoleName = z.enum(['ADMIN', 'EDITOR', 'VIEWER', 'AGENT']);
export type RoleName = z.infer<typeof RoleName>;

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: '시스템 관리자',
  EDITOR: '챗봇 편집자',
  VIEWER: '운영 모니터',
  AGENT: '상담원',
};

/* ── 권한 17종 유니온 (FR-0-25, FR-12-18, ADR-0029 §5, ADR-0036 §7) ──
   ⚠ 기존 75곳+의 @RequirePermission 문자열이 전부 이 목록에 존재해야 한다.
   명명 규칙: `<도메인>:<동작>`. 새 도메인이 생기면 이 규칙으로 추가한다.
   [신규 2026-09-23 검증/품질 고도화] `simulation:write`(14→15) — TC 세트/실행의 쓰기·실행·취소·고정을
   가리키는 권한이다. "읽기 simulation:read / 쓰기 dialogue:write" 조합(신규 문자열 0종)도 대안이었으나,
   한 화면의 읽기·쓰기가 두 도메인으로 갈라지는 어색함을 피하기 위해 신설을 확정했다(ADR-0029 §5).
   [신규 2026-09-25 하이브리드 CS No.24] `cs:read`·`cs:write`(15→17) — 상담 스레드 조회/개입·전송·
   종료·인수 권한. 기존 `dialogue:*`/`chatbot:*`과 위험 성격이 달라 별도 도메인으로 신설한다(ADR-0036 §7). */
export const Permission = z.enum([
  'chatbot:read',
  'chatbot:write',
  'chatbot:delete',
  'chatbot:purge',
  'dialogue:read',
  'dialogue:write',
  'channel:read',
  'channel:write',
  'simulation:read',
  'simulation:write',
  'user:read',
  'user:write',
  'security:read',
  'security:write',
  'audit:read',
  'cs:read',
  'cs:write',
]);
export type Permission = z.infer<typeof Permission>;

/* ── 역할→권한 매핑 (DD-39, ADR-0015). FE/BE 공통 단일 소스다.
   프런트는 이 상수를 재계산하지 않고 `GET /auth/me`가 반환한 permissions[]를 쓴다(NFR-S6). ── */
export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  VIEWER: ['chatbot:read', 'dialogue:read', 'channel:read', 'simulation:read'],
  EDITOR: [
    'chatbot:read',
    'dialogue:read',
    'channel:read',
    'simulation:read',
    'chatbot:write',
    'chatbot:delete',
    'dialogue:write',
    'channel:write',
    'simulation:write',
    // [No.24] EDITOR는 상담을 읽을 수만 있다(개입·전송·종료는 AGENT·ADMIN 전용, P-7).
    'cs:read',
  ],
  // [신규 2026-09-25 No.24] 상담원 — 챗봇 조회(마스킹본 등급) + 상담 읽기/쓰기만. `dialogue:*` 없음
  // (대화 자산 편집 화면은 볼 수 없다) — 계층형 역할이 아니다(AGENT ⊄ VIEWER).
  AGENT: ['chatbot:read', 'cs:read', 'cs:write'],
  ADMIN: [
    'chatbot:read',
    'dialogue:read',
    'channel:read',
    'simulation:read',
    'chatbot:write',
    'chatbot:delete',
    'dialogue:write',
    'channel:write',
    'simulation:write',
    'chatbot:purge',
    'user:read',
    'user:write',
    'security:read',
    'security:write',
    'audit:read',
    'cs:read',
    'cs:write',
  ],
};

export function hasPermission(role: RoleName, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/* ── 사용자 ── */
export const UserStatus = z.enum(['ACTIVE', 'DISABLED']);
export type UserStatus = z.infer<typeof UserStatus>;

/** ⚠ `passwordHash`는 이 스키마에 존재하지 않는다 — 타입 수준에서 응답 유출을 막는다(NFR-S1). */
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: RoleName,
  status: UserStatus,
  mustChangePassword: z.boolean(),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const UserListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: csvEnumArray(RoleName),
  status: UserStatus.optional(),
  /** 공통 규약의 명시적 예외 — 기본 정렬은 `createdAt desc`다(FR-12-24). */
  sort: z.enum(['createdAt', 'name', 'email', 'lastLoginAt']).default('createdAt'),
  order: SortOrder.default('desc'),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  role: RoleName,
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: RoleName.optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const UpdateUserStatusSchema = z.object({ status: UserStatus });
export type UpdateUserStatusDto = z.infer<typeof UpdateUserStatusSchema>;

/** 임시 비밀번호는 이 응답에서 1회만 반환된다(FR-12-25, NFR-S13). 재조회 API는 존재하지 않는다. */
export const CreateUserResponseSchema = z.object({
  user: UserSchema,
  temporaryPassword: z.string(),
});
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

export const PasswordResetResponseSchema = z.object({
  temporaryPassword: z.string(),
});
export type PasswordResetResponse = z.infer<typeof PasswordResetResponseSchema>;

/** `GET /roles` 응답 — 상수 소스가 서버임을 보장한다(FR-12-21). */
export const RoleListItemSchema = z.object({
  role: RoleName,
  label: z.string(),
  permissions: z.array(Permission),
});
export type RoleListItem = z.infer<typeof RoleListItemSchema>;

/* ── 인증 ── */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;

export const CurrentUserSchema = UserSchema.extend({
  permissions: z.array(Permission),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/**
 * `status` 판별 필드로 MFA 확장 지점을 하위호환으로 남긴다(J-2, ADR-0014 §5).
 * 지금은 `'OK'` 리터럴 1종뿐이다.
 */
export const LoginResponseSchema = z.object({
  status: z.literal('OK'),
  user: CurrentUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

/* ── 비밀번호 정책 (FR-12-12) — FE/BE가 같은 함수를 쓴다 ── */
export const PASSWORD_POLICY = { minLength: 10, minCharClasses: 2 } as const;

export type PasswordRuleId = 'LENGTH' | 'CHAR_CLASSES' | 'EMAIL_LOCALPART';

export interface PasswordPolicyViolation {
  rule: PasswordRuleId;
  message: string;
}

export interface PasswordPolicyResult {
  ok: boolean;
  violations: PasswordPolicyViolation[];
}

/**
 * 비밀번호 정책 판정 순수 함수(NFR-M1). "현재 비밀번호와 동일 금지"는 평문 비교가 필요해
 * 이 함수의 책임 밖이다(서비스 계층이 `verifyPassword`로 별도 판정한다).
 */
export function validatePasswordPolicy(password: string, opts: { email?: string } = {}): PasswordPolicyResult {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    violations.push({ rule: 'LENGTH', message: `비밀번호는 최소 ${PASSWORD_POLICY.minLength}자 이상이어야 합니다.` });
  }

  const classCount = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classCount < PASSWORD_POLICY.minCharClasses) {
    violations.push({ rule: 'CHAR_CLASSES', message: '영문/숫자/특수문자 중 2종 이상을 포함해야 합니다.' });
  }

  const localPart = opts.email?.split('@')[0]?.trim().toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    violations.push({ rule: 'EMAIL_LOCALPART', message: '이메일 아이디를 포함할 수 없습니다.' });
  }

  return { ok: violations.length === 0, violations };
}

/** 이메일 정규화(§3.3) — trim + 소문자. 손실이 없어 별도 컬럼을 두지 않고 `email`에 그대로 저장한다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* ── 금지어 (DD-36, J-3) ── */
export const BannedWordMatchType = z.enum(['EXACT', 'CONTAINS']);
export type BannedWordMatchType = z.infer<typeof BannedWordMatchType>;

export const BannedWordPolicy = z.enum(['BLOCK', 'WARN']);
export type BannedWordPolicy = z.infer<typeof BannedWordPolicy>;

export const BannedWordSchema = z.object({
  id: z.string().uuid(),
  word: z.string().min(1).max(100),
  wordNormalized: z.string(),
  matchType: BannedWordMatchType,
  policy: BannedWordPolicy,
  enabled: z.boolean(),
  description: z.string().max(500).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type BannedWord = z.infer<typeof BannedWordSchema>;

export const BannedWordListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  policy: csvEnumArray(BannedWordPolicy),
  enabled: queryBoolean().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'word']).default('updatedAt'),
  order: SortOrder.default('desc'),
});
export type BannedWordListQuery = z.infer<typeof BannedWordListQuerySchema>;

export const CreateBannedWordSchema = z.object({
  word: z.string().trim().min(1).max(100),
  matchType: BannedWordMatchType.default('CONTAINS'),
  policy: BannedWordPolicy.default('BLOCK'),
  enabled: z.boolean().default(true),
  description: z.string().max(500).optional(),
});
export type CreateBannedWordDto = z.infer<typeof CreateBannedWordSchema>;

export const UpdateBannedWordSchema = z.object({
  word: z.string().trim().min(1).max(100).optional(),
  matchType: BannedWordMatchType.optional(),
  policy: BannedWordPolicy.optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).nullable().optional(),
});
export type UpdateBannedWordDto = z.infer<typeof UpdateBannedWordSchema>;

export const BannedWordTestRequestSchema = z.object({
  text: z.string().min(1).max(1000),
});
export type BannedWordTestRequestDto = z.infer<typeof BannedWordTestRequestSchema>;

export const BannedWordTestMatchSchema = z.object({
  word: z.string(),
  matchType: BannedWordMatchType,
  policy: BannedWordPolicy,
});

export const BannedWordTestResponseSchema = z.object({
  matches: z.array(BannedWordTestMatchSchema),
  maskedText: z.string(),
  decision: z.enum(['PASS', 'WARN', 'BLOCK']),
});
export type BannedWordTestResponse = z.infer<typeof BannedWordTestResponseSchema>;
