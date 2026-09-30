import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApproveProdSwitchSchema, CreateProdSwitchApprovalSchema, RejectProdSwitchSchema, UpdateApprovalPolicySchema } from '@chat-bot/shared-types';
import type {
  ApprovalPolicyStatus,
  ApproveProdSwitchDto,
  ApproveProdSwitchResponse,
  CreateProdSwitchApprovalDto,
  ProdSwitchApprovalDetail,
  ProdSwitchApprovalSummary,
  RejectProdSwitchDto,
  UpdateApprovalPolicyDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SessionUser } from '../../common/auth/session-context';
import { VersionBundleService } from '../serving/version-bundle.service';
import { SwitchApprovalService } from './switch-approval.service';

/**
 * [신규 No.36] 운영 전환 2인 승인 — 챗봇 스코프 7 핸들러(ai-guardrails-설계.md §13.1). 조회 `chatbot:read`+`dialogue:read`,
 * 정책 변경·요청·승인·반려·취소 `chatbot:deploy`(운영 전환 권한 — 신규 권한 0). 요청자 ≠ 승인자는 서버가 강제한다.
 */
@Controller('chatbots/:chatbotId/environment/approval')
export class SwitchApprovalsController {
  constructor(
    private readonly approvals: SwitchApprovalService,
    private readonly versionBundles: VersionBundleService,
  ) {}

  @Get()
  @RequirePermission('chatbot:read', 'dialogue:read')
  getStatus(@Param('chatbotId') chatbotId: string, @CurrentUser() user: SessionUser): Promise<ApprovalPolicyStatus> {
    return this.approvals.getStatus(chatbotId, user);
  }

  @Put()
  @RequirePermission('chatbot:deploy')
  updatePolicy(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(UpdateApprovalPolicySchema)) dto: UpdateApprovalPolicyDto,
    @CurrentUser() user: SessionUser,
  ): Promise<ApprovalPolicyStatus> {
    return this.approvals.updatePolicy(chatbotId, dto, user);
  }

  @Post('requests')
  @RequirePermission('chatbot:deploy')
  @HttpCode(HttpStatus.CREATED)
  createRequest(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateProdSwitchApprovalSchema)) dto: CreateProdSwitchApprovalDto,
    @CurrentUser() user: SessionUser,
  ): Promise<ProdSwitchApprovalSummary> {
    return this.approvals.createRequest(chatbotId, dto, user);
  }

  @Get('requests/:requestId')
  @RequirePermission('chatbot:read', 'dialogue:read')
  getRequest(@Param('chatbotId') chatbotId: string, @Param('requestId') requestId: string, @CurrentUser() user: SessionUser): Promise<ProdSwitchApprovalDetail> {
    return this.approvals.getRequest(chatbotId, requestId, user);
  }

  @Post('requests/:requestId/approve')
  @RequirePermission('chatbot:deploy')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('chatbotId') chatbotId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(ApproveProdSwitchSchema)) dto: ApproveProdSwitchDto,
    @CurrentUser() user: SessionUser,
  ): Promise<ApproveProdSwitchResponse> {
    const result = await this.approvals.approve(chatbotId, requestId, dto, user);
    // 기존 `prod/switch`와 같다 — 커밋 뒤 새 운영 버전을 데운다(best-effort).
    if (result.switch?.outcome === 'APPLIED') this.versionBundles.warm(chatbotId, result.switch.prod.versionId);
    return result;
  }

  @Post('requests/:requestId/reject')
  @RequirePermission('chatbot:deploy')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('chatbotId') chatbotId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(RejectProdSwitchSchema)) dto: RejectProdSwitchDto,
    @CurrentUser() user: SessionUser,
  ): Promise<ProdSwitchApprovalSummary> {
    return this.approvals.reject(chatbotId, requestId, dto, user);
  }

  @Post('requests/:requestId/cancel')
  @RequirePermission('chatbot:deploy')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('chatbotId') chatbotId: string, @Param('requestId') requestId: string, @CurrentUser() user: SessionUser): Promise<ProdSwitchApprovalSummary> {
    return this.approvals.cancel(chatbotId, requestId, user);
  }
}
