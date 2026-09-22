import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateUserDto,
  CreateUserResponse,
  Paginated,
  PasswordResetResponse,
  UpdateUserDto,
  UpdateUserStatusDto,
  User,
  UserListQuery,
  normalizeEmail,
  validatePasswordPolicy,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { hashPassword } from '../common/auth/lib/password-hash';
import { SessionService } from '../auth/session.service';
import { generateTemporaryPassword } from '../auth/lib/temporary-password';
import { toUserDto } from './user.mapper';
import { isLastActiveAdmin, isSelfModification } from './lib/last-admin';

const NOT_FOUND_MESSAGE = '요청하신 회원을 찾을 수 없습니다.';

/**
 * 회원·권한 관리(No.12-a/b, J-7 — 사용자 그룹 테이블은 만들지 않는다).
 * 마지막 관리자 보호는 트랜잭션 내부에서 재확인한다(FR-12-32, 동시 요청 경합 방어).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly sessionService: SessionService,
  ) {}

  async list(query: UserListQuery): Promise<Paginated<User>> {
    const where: Prisma.UserWhereInput = {};
    if (query.q) where.OR = [{ email: { contains: query.q } }, { name: { contains: query.q } }];
    if (query.role && query.role.length > 0) where.role = { in: query.role };
    if (query.status) where.status = query.status;
    const orderBy = { [query.sort]: query.order } as Prisma.UserOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return toPaginated(rows.map(toUserDto), total, query.page, query.pageSize);
  }

  async findOne(id: string): Promise<User> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return toUserDto(row);
  }

  /** 이메일은 정규화(trim+소문자) 후 유일하다(FR-12-26). 임시 비밀번호는 이 응답에서 1회만 반환된다. */
  async create(dto: CreateUserDto): Promise<CreateUserResponse> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiException('DUPLICATE_EMAIL', 409, '이미 등록된 이메일입니다.');

    const temporaryPassword = await this.generateValidTemporaryPassword(email);
    const passwordHash = await hashPassword(temporaryPassword);

    const row = await this.prisma.user.create({
      data: { email, name: dto.name, role: dto.role, passwordHash, mustChangePassword: true },
    });

    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'User',
      targetId: row.id,
      targetName: row.name,
      after: row,
    });

    return { user: toUserDto(row), temporaryPassword };
  }

  /** 이름·역할 수정(FR-12-27). 이메일 변경은 제공하지 않는다 — 감사 추적의 주체 식별자가 흔들린다. */
  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<User> {
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id } });
      if (!current) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

      const roleChanging = dto.role !== undefined && dto.role !== current.role;

      // C-2: LAST_ADMIN을 SELF_MODIFICATION보다 먼저 판정한다(설계서 §2.3).
      if (roleChanging && current.role === 'ADMIN') {
        const activeAdminCount = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
        if (isLastActiveAdmin({ id: current.id, role: current.role, status: current.status }, activeAdminCount)) {
          throw new ApiException('LAST_ADMIN', 409, '마지막 관리자의 역할은 변경할 수 없습니다.');
        }
      }
      if (roleChanging && isSelfModification(actorId, id)) {
        throw new ApiException('SELF_MODIFICATION', 409, '본인의 역할은 변경할 수 없습니다.');
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
      });
      return { before: current, after: updated };
    });

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'User',
      targetId: after.id,
      targetName: after.name,
      before,
      after,
      summary: dto.role !== undefined && dto.role !== before.role ? `역할 변경: ${before.role} → ${after.role}` : undefined,
    });

    return toUserDto(after);
  }

  /** `ACTIVE`/`DISABLED` 전환(FR-12-28). 비활성화 시 전 세션을 즉시 무효화한다. */
  async updateStatus(id: string, dto: UpdateUserStatusDto, actorId: string): Promise<User> {
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id } });
      if (!current) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

      const statusChanging = dto.status !== current.status;

      if (statusChanging && dto.status === 'DISABLED' && current.role === 'ADMIN') {
        const activeAdminCount = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
        if (isLastActiveAdmin({ id: current.id, role: current.role, status: current.status }, activeAdminCount)) {
          throw new ApiException('LAST_ADMIN', 409, '마지막 관리자는 비활성화할 수 없습니다.');
        }
      }
      if (statusChanging && isSelfModification(actorId, id)) {
        throw new ApiException('SELF_MODIFICATION', 409, '본인 계정의 상태는 변경할 수 없습니다.');
      }

      const updated = await tx.user.update({ where: { id }, data: { status: dto.status } });
      return { before: current, after: updated };
    });

    if (before.status !== after.status && after.status === 'DISABLED') {
      await this.sessionService.revokeAllForUser(after.id);
    }

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'User',
      targetId: after.id,
      targetName: after.name,
      before,
      after,
      summary: `상태 변경: ${before.status} → ${after.status}`,
    });

    return toUserDto(after);
  }

  /** ADMIN이 임시 비밀번호를 재발급한다(FR-12-29). 메일 발송은 하지 않는다(§9.1). */
  async resetPassword(id: string): Promise<PasswordResetResponse> {
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const temporaryPassword = await this.generateValidTemporaryPassword(current.email);
    const passwordHash = await hashPassword(temporaryPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    await this.sessionService.revokeAllForUser(id);

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'User',
      targetId: id,
      targetName: current.name,
      summary: '비밀번호 초기화',
    });

    return { temporaryPassword };
  }

  /** 생성된 임시 비밀번호가 정책을 만족하도록 소수 회 재시도한다(고정 접미사로 사실상 항상 1회 통과). */
  private async generateValidTemporaryPassword(email: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateTemporaryPassword();
      if (validatePasswordPolicy(candidate, { email }).ok) return candidate;
    }
    return generateTemporaryPassword();
  }
}
