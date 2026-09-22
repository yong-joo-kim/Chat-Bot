import type { User as PrismaUser } from '@prisma/client';
import type { RoleName, User, UserStatus } from '@chat-bot/shared-types';

/** `passwordHash`는 절대 옮기지 않는다 — `UserSchema`에 그 필드가 존재하지 않아 타입으로도 막힌다(NFR-S1). */
export function toUserDto(row: PrismaUser): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as RoleName,
    status: row.status as UserStatus,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
