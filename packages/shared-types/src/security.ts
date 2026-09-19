import { z } from 'zod';

/** No.12 회원·권한·보안 관리 — Phase1은 3단계 역할만 지원 */
export const RoleName = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);
export type RoleName = z.infer<typeof RoleName>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: RoleName,
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = UserSchema.pick({ email: true, name: true, role: true });
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/** No.13 이력관리(변경 이력 + API 연동 상세 로그) */
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  targetType: z.string().min(1).max(50),
  targetId: z.string().min(1),
  /** 변경 전/후 값(JSON 직렬화) — 민감정보(대화원문 등)는 기록하지 않는다 */
  beforeValue: z.string().optional(),
  afterValue: z.string().optional(),
  createdAt: z.coerce.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
