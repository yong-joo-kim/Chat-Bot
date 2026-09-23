import { Injectable } from '@nestjs/common';
import { hasPermission } from '@chat-bot/shared-types';
import type { Permission, RoleName } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export interface VerifiedActor {
  id: string;
  email: string;
  role: RoleName;
}

/**
 * [신규 2026-09-23 No.28] 실행 직전 예약자 재검증(FR-D3-12, §8.3). `mustChangePassword`·세션 만료는
 * 보지 않는다(권한 박탈이 아니다). 통과 시 반환하는 값이 감사 주체(`actorOverride`)가 된다.
 */
@Injectable()
export class CreatorVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(createdById: string, permissions: readonly Permission[]): Promise<VerifiedActor | null> {
    const user = await this.prisma.user.findUnique({ where: { id: createdById }, select: { id: true, email: true, role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return null;
    const role = user.role as RoleName;
    if (!permissions.every((p) => hasPermission(role, p))) return null;
    return { id: user.id, email: user.email, role };
  }
}
