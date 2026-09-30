import { Controller, Get, Query } from '@nestjs/common';
import { ApprovalListQuerySchema } from '@chat-bot/shared-types';
import type { ApprovalListQuery, ApprovalSummaryResponse, Paginated, ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { SwitchApprovalService } from './switch-approval.service';

/**
 * [신규 No.36] 운영 전환 승인 전역 화면용 2 핸들러(ai-guardrails-설계.md §13.1) — 승인할 수 있는 사람(`chatbot:deploy`)만 본다.
 * 두 핸들러 모두 지연 종결(만료·기준 변경)을 수행한 뒤 응답한다.
 */
@Controller('environment-approvals')
export class EnvironmentApprovalsGlobalController {
  constructor(private readonly approvals: SwitchApprovalService) {}

  @Get()
  @RequirePermission('chatbot:deploy')
  list(@Query(new ZodQueryPipe(ApprovalListQuerySchema)) query: ApprovalListQuery, @CurrentUser() user: SessionUser): Promise<Paginated<ProdSwitchApprovalSummary>> {
    return this.approvals.listGlobal(query, user);
  }

  /** 콘솔 배지 — `pendingForMe` = 내가 요청자가 아닌 대기 건수. (`summary`는 위 목록과 경로가 겹치지 않는다.) */
  @Get('summary')
  @RequirePermission('chatbot:deploy')
  summary(@CurrentUser() user: SessionUser): Promise<ApprovalSummaryResponse> {
    return this.approvals.summary(user);
  }
}
