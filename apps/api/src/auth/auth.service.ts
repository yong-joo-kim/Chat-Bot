import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChangePasswordDto,
  CurrentUser,
  LoginRequestDto,
  ROLE_PERMISSIONS,
  RoleName,
  UserStatus,
  normalizeEmail,
  validatePasswordPolicy,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { hashPassword, verifyPassword } from '../common/auth/lib/password-hash';
import type { SessionUser } from '../common/auth/session-context';
import { SessionService } from './session.service';

export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  token: string;
  user: CurrentUser;
}

const INVALID_CREDENTIALS_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다.';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 로그인/로그아웃/비밀번호 변경(No.12-c, ADR-0014). 인증·인가 이력(`LOGIN`/`LOGIN_FAILED`/`LOGOUT`)은
 * FR-0-27의 명시적 예외로 이 서비스가 직접 기록한다(ADR-0016 §9.4).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sessionService: SessionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private loginMaxFailures(): number {
    return this.config.get<number>('LOGIN_MAX_FAILURES') ?? 5;
  }

  private loginLockoutMin(): number {
    return this.config.get<number>('LOGIN_LOCKOUT_MIN') ?? 15;
  }

  /**
   * 로그인(FR-12-1~6). 계정 열거 방지(FR-12-2/3) — 이메일 미존재·비밀번호 불일치·비활성 계정 모두
   * 동일한 `401 INVALID_CREDENTIALS`다. 잠금 상태만 예외로 구분한다(C-1).
   */
  async login(dto: LoginRequestDto, meta: LoginMeta): Promise<LoginResult> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutesLeft = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new ApiException('ACCOUNT_LOCKED', 401, `로그인 시도가 너무 많습니다. ${minutesLeft}분 후 다시 시도해 주세요.`);
    }

    const passwordOk = await verifyPassword(dto.password, user?.passwordHash ?? null);
    const accountUsable = user !== null && user.status === 'ACTIVE';

    if (!passwordOk || !accountUsable) {
      if (user) await this.registerFailure(user.id, user.failedLoginCount);
      await this.auditLogService.record({
        action: 'LOGIN_FAILED',
        targetType: 'Session',
        targetId: '-',
        summary: `로그인 실패: ${email}`,
        actorOverride: { id: null, email, role: null },
      });
      throw new ApiException('INVALID_CREDENTIALS', 401, INVALID_CREDENTIALS_MESSAGE);
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });

    const token = await this.sessionService.issue(user.id, meta);

    await this.auditLogService.record({
      action: 'LOGIN',
      targetType: 'Session',
      targetId: user.id,
      targetName: user.name,
      summary: `로그인 성공: ${email}`,
      actorOverride: { id: user.id, email: user.email, role: user.role },
    });

    return { token, user: this.toCurrentUser({ ...user, lastLoginAt: now }) };
  }

  private async registerFailure(userId: string, currentCount: number): Promise<void> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= this.loginMaxFailures();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextCount,
        ...(shouldLock ? { lockedUntil: new Date(Date.now() + this.loginLockoutMin() * 60_000) } : {}),
      },
    });
  }

  /** 로그아웃(FR-12-8) — 멱등. 쿠키가 없거나 이미 무효화된 세션이면 기록도 남기지 않는다(§9.4). */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const revoked = await this.sessionService.revokeAndDescribe(token);
    if (!revoked) return;

    await this.auditLogService.record({
      action: 'LOGOUT',
      targetType: 'Session',
      targetId: revoked.userId,
      summary: `로그아웃: ${revoked.email}`,
      actorOverride: { id: revoked.userId, email: revoked.email, role: revoked.role },
    });
  }

  /** `GET /auth/me`(FR-12-9) — 가드가 이미 조회한 세션 사용자를 그대로 반환한다(추가 쿼리 없음). */
  getMe(user: SessionUser): CurrentUser {
    return this.toCurrentUser(user);
  }

  /** 본인 비밀번호 변경(FR-12-10~12). 성공 시 다른 모든 세션을 무효화하고 현재 세션은 재발급한다(FR-12-11). */
  async changePassword(actor: SessionUser, dto: ChangePasswordDto): Promise<string> {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });

    const currentOk = await verifyPassword(dto.currentPassword, current.passwordHash);
    if (!currentOk) throw new ApiException('INVALID_CREDENTIALS', 401, '현재 비밀번호가 일치하지 않습니다.');

    if (dto.newPassword === dto.currentPassword) {
      throw new ApiException('PASSWORD_POLICY', 400, '비밀번호 정책을 만족하지 않습니다.', [
        { field: 'newPassword', message: '현재 비밀번호와 동일한 비밀번호는 사용할 수 없습니다.' },
      ]);
    }

    const policy = validatePasswordPolicy(dto.newPassword, { email: current.email });
    if (!policy.ok) {
      throw new ApiException(
        'PASSWORD_POLICY',
        400,
        '비밀번호 정책을 만족하지 않습니다.',
        policy.violations.map((v) => ({ field: 'newPassword', message: v.message })),
      );
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: current.id }, data: { passwordHash, mustChangePassword: false } });

    await this.sessionService.revokeAllForUser(current.id);
    const newToken = await this.sessionService.issue(current.id);

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'User',
      targetId: current.id,
      targetName: current.name,
      summary: '비밀번호 변경',
    });

    return newToken;
  }

  toCurrentUser(user: UserRow): CurrentUser {
    const role = user.role as RoleName;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status: user.status as UserStatus,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      permissions: [...ROLE_PERMISSIONS[role]],
    };
  }
}
