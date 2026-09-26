import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateAnonymousCustomerSchema,
  CustomerSearchSchema,
  LinkSessionSchema,
  MergeCustomerSchema,
  SessionLinkLookupQuerySchema,
} from '@chat-bot/shared-types';
import type {
  CreateAnonymousCustomerDto,
  CreateAnonymousCustomerResponse,
  CustomerSearchDto,
  CustomerSearchResponse,
  IdentitySpaceListResponse,
  LinkSessionDto,
  MergeCustomerDto,
  MergeResult,
  RevertMergeResult,
  SessionLinkLookupQuery,
  SessionLinkLookupResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { AuditView } from '../../audit-logs/access/audit-view.decorator';
import { InboxEnabledGuard } from '../guards/inbox-enabled.guard';
import { InboxQueryService } from '../read/inbox-query.service';
import { InboxCustomersService } from '../manage/inbox-customers.service';

/** [신규 No.42] 고객 검색·연결·병합(§14.1 — 8 핸들러). */
@UseGuards(InboxEnabledGuard)
@Controller('inbox')
export class InboxCustomersController {
  constructor(
    private readonly query: InboxQueryService,
    private readonly customers: InboxCustomersService,
  ) {}

  @Post('customers/search')
  @RequirePermission('cs:read')
  @AuditView({ targetType: 'Customer' })
  search(@Body(new ZodValidationPipe(CustomerSearchSchema)) dto: CustomerSearchDto): Promise<CustomerSearchResponse> {
    return this.query.searchCustomers(dto);
  }

  @Post('customers')
  @RequirePermission('cs:write')
  create(@Body(new ZodValidationPipe(CreateAnonymousCustomerSchema)) dto: CreateAnonymousCustomerDto, @CurrentUser() actor: SessionUser): Promise<CreateAnonymousCustomerResponse> {
    return this.customers.createAnonymous(dto, actor);
  }

  @Get('session-link')
  @RequirePermission('cs:read')
  sessionLink(@Query(new ZodValidationPipe(SessionLinkLookupQuerySchema)) query: SessionLinkLookupQuery): Promise<SessionLinkLookupResponse> {
    return this.query.sessionLink(query.chatbotId, query.sessionRef);
  }

  @Get('identity-spaces')
  @RequirePermission('cs:read')
  identitySpaces(): Promise<IdentitySpaceListResponse> {
    return this.query.identitySpaces();
  }

  @Post('customers/:customerId/links')
  @RequirePermission('cs:write')
  link(@Param('customerId') customerId: string, @Body(new ZodValidationPipe(LinkSessionSchema)) dto: LinkSessionDto, @CurrentUser() actor: SessionUser): Promise<void> {
    return this.customers.link(customerId, dto, actor);
  }

  @Delete('customers/:customerId/links/:linkId')
  @RequirePermission('cs:write')
  unlink(@Param('customerId') customerId: string, @Param('linkId') linkId: string, @CurrentUser() actor: SessionUser): Promise<void> {
    return this.customers.unlink(customerId, linkId, actor);
  }

  @Post('customers/:customerId/merge')
  @RequirePermission('cs:write')
  merge(@Param('customerId') customerId: string, @Body(new ZodValidationPipe(MergeCustomerSchema)) dto: MergeCustomerDto, @CurrentUser() actor: SessionUser): Promise<MergeResult> {
    return this.customers.merge(customerId, dto, actor);
  }

  @Post('merges/:mergeId/revert')
  @RequirePermission('cs:write')
  revert(@Param('mergeId') mergeId: string, @CurrentUser() actor: SessionUser): Promise<RevertMergeResult> {
    return this.customers.revertMerge(mergeId, actor);
  }
}
