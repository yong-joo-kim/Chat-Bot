import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { RoleName, UserStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { computeInitialExpiry, isSessionValid, nextSlidingExpiry, shouldRefresh } from './lib/session-expiry';
import type { SessionUser } from '../common/auth/session-context';

export interface ResolvedSession {
  user: SessionUser;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 세션 발급·검증·무효화(J-1, ADR-0014). `PermissionGuard`가 주입받는 유일한 세션 조회 경로다.
 * 토큰 원문은 저장하지 않고 `sha256(token)` hex만 저장한다(NFR-S2).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private idleTimeoutMin(): number {
    return this.config.get<number>('SESSION_IDLE_TIMEOUT_MIN') ?? 120;
  }

  private absoluteTimeoutHours(): number {
    return this.config.get<number>('SESSION_ABSOLUTE_TIMEOUT_HOURS') ?? 12;
  }

  /** 로그인 성공 시 세션을 발급한다. 해당 사용자의 만료·무효 세션을 함께 정리한다(§7.3 — 별도 배치 없음). */
  async issue(userId: string, meta: { ip?: string; userAgent?: string } = {}): Promise<string> {
    const now = new Date();
    await this.prisma.session.deleteMany({
      where: {
        userId,
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }],
      },
    });

    const token = randomBytes(32).toString('base64url');
    const { expiresAt, absoluteExpiresAt } = computeInitialExpiry(now, this.idleTimeoutMin(), this.absoluteTimeoutHours());

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        absoluteExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return token;
  }

  /** 매 요청 세션 검증(1쿼리 — 캐시를 두지 않는다, DD-42). 유효하면 슬라이딩 만료를 갱신한다. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const tokenHash = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session) return null;
    if (!isSessionValid(session, new Date())) return null;

    const now = new Date();
    if (shouldRefresh(session.lastSeenAt, now, this.idleTimeoutMin())) {
      const expiresAt = nextSlidingExpiry(now, this.idleTimeoutMin(), session.absoluteExpiresAt);
      try {
        await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
      } catch {
        // 동시 로그아웃 등으로 레코드가 사라진 경합 — 이번 요청의 인증 판정에는 영향 없다.
      }
    }

    const user = session.user;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as RoleName,
        status: user.status as UserStatus,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * 로그아웃(FR-12-8) — 이미 무효화된 세션(또는 존재하지 않는 세션)도 멱등하게 처리한다(`null` 반환).
   * 감사 기록(`LOGOUT`)에 필요한 사용자 스냅샷을 함께 돌려준다(§9.4 — 유효 세션이 있었을 때만 기록).
   */
  async revokeAndDescribe(token: string): Promise<{ userId: string; email: string; role: string } | null> {
    const tokenHash = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.revokedAt) return null;
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return { userId: session.user.id, email: session.user.email, role: session.user.role };
  }

  /** 전 세션 무효화(FR-12-11 비밀번호 변경, FR-12-28 계정 비활성, FR-12-29 비밀번호 초기화). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
