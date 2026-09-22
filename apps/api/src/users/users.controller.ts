import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateUserDto,
  CreateUserResponse,
  CreateUserSchema,
  Paginated,
  PasswordResetResponse,
  UpdateUserDto,
  UpdateUserSchema,
  UpdateUserStatusDto,
  UpdateUserStatusSchema,
  User,
  UserListQuery,
  UserListQuerySchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-context';
import { UsersService } from './users.service';

/** 회원 관리(No.12-a). 물리 삭제 API는 제공하지 않는다(FR-12-30 — 비활성화로 대체). */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('user:read')
  list(@Query(new ZodQueryPipe(UserListQuerySchema)) query: UserListQuery): Promise<Paginated<User>> {
    return this.usersService.list(query);
  }

  @Post()
  @RequirePermission('user:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto): Promise<CreateUserResponse> {
    return this.usersService.create(dto);
  }

  @Get(':id')
  @RequirePermission('user:read')
  findOne(@Param('id') id: string): Promise<User> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('user:write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<User> {
    return this.usersService.update(id, dto, actor.id);
  }

  @Patch(':id/status')
  @RequirePermission('user:write')
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserStatusSchema)) dto: UpdateUserStatusDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<User> {
    return this.usersService.updateStatus(id, dto, actor.id);
  }

  @Post(':id/password-reset')
  @RequirePermission('user:write')
  resetPassword(@Param('id') id: string): Promise<PasswordResetResponse> {
    return this.usersService.resetPassword(id);
  }
}
