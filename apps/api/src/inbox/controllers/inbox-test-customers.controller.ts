import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { CreateTestCustomerSchema, SimulateInboxSchema } from '@chat-bot/shared-types';
import type { CreateTestCustomerDto, CreateTestCustomerResponse, SimulateInboxDto, SimulateInboxResponse } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { InboxEnabledGuard } from '../guards/inbox-enabled.guard';
import { InboxTestCustomersService } from '../manage/inbox-test-customers.service';

/** [신규 No.42] 시험 고객·시뮬레이션(§14.1 — 3 핸들러). `simulation:write` AND `cs:read`(AGENT 배제). */
@UseGuards(InboxEnabledGuard)
@Controller('inbox/test-customers')
export class InboxTestCustomersController {
  constructor(private readonly service: InboxTestCustomersService) {}

  @Post()
  @RequirePermission('simulation:write', 'cs:read')
  create(@Body(new ZodValidationPipe(CreateTestCustomerSchema)) dto: CreateTestCustomerDto, @CurrentUser() actor: SessionUser): Promise<CreateTestCustomerResponse> {
    return this.service.create(dto, actor);
  }

  @Delete(':customerId')
  @RequirePermission('simulation:write', 'cs:read')
  remove(@Param('customerId') customerId: string, @CurrentUser() actor: SessionUser): Promise<void> {
    return this.service.remove(customerId, actor);
  }

  @Post(':customerId/simulate')
  @RequirePermission('simulation:write', 'cs:read')
  simulate(@Param('customerId') customerId: string, @Body(new ZodValidationPipe(SimulateInboxSchema)) dto: SimulateInboxDto, @CurrentUser() actor: SessionUser): Promise<SimulateInboxResponse> {
    return this.service.simulate(customerId, dto, actor);
  }
}
