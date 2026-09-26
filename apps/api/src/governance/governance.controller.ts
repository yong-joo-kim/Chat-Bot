import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import type {
  GlobalRetentionUpdateDto,
  GovernanceMapResponse,
  PaginationQuery,
  RetentionOverrideListResponse,
  RetentionPolicyResponse,
  RetentionPreviewRequestDto,
  RetentionPreviewResponse,
  RetentionRunListQuery,
  RetentionRunListResponse,
} from '@chat-bot/shared-types';
import { GlobalRetentionUpdateSchema, PaginationQuerySchema, RetentionPreviewRequestSchema, RetentionRunListQuerySchema } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { GovernanceMapService } from './governance-map.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionRunQueryService } from './retention-run-query.service';

/**
 * 데이터 거버넌스 — 데이터 지도·전역 보존 정책·파기 이력·챗봇 재정의 목록(No.45 §15.1). 챗봇별
 * 재정의 저장·조회 자체는 `ChatbotRetentionController`(`chatbots/:chatbotId/retention*`)가 담당한다.
 */
@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly mapService: GovernanceMapService,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly retentionRuns: RetentionRunQueryService,
  ) {}

  @Get('map')
  @RequirePermission('security:read')
  getMap(): Promise<GovernanceMapResponse> {
    return this.mapService.build();
  }

  @Get('retention')
  @RequirePermission('security:read')
  getRetention(): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.getGlobal();
  }

  @Put('retention')
  @RequirePermission('security:write')
  updateRetention(@Body(new ZodValidationPipe(GlobalRetentionUpdateSchema)) dto: GlobalRetentionUpdateDto): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.updateGlobal(dto);
  }

  @Post('retention/preview')
  @RequirePermission('security:read')
  previewRetention(@Body(new ZodValidationPipe(RetentionPreviewRequestSchema)) dto: RetentionPreviewRequestDto): Promise<RetentionPreviewResponse> {
    return this.retentionPolicy.preview(dto);
  }

  @Post('retention/pending/cancel')
  @RequirePermission('security:write')
  cancelPending(): Promise<RetentionPolicyResponse> {
    return this.retentionPolicy.cancelPending();
  }

  @Get('retention-runs')
  @RequirePermission('security:read')
  listRuns(@Query(new ZodQueryPipe(RetentionRunListQuerySchema)) query: RetentionRunListQuery): Promise<RetentionRunListResponse> {
    return this.retentionRuns.list(query);
  }

  @Get('retention/overrides')
  @RequirePermission('security:read')
  listOverrides(@Query(new ZodQueryPipe(PaginationQuerySchema)) query: PaginationQuery): Promise<RetentionOverrideListResponse> {
    return this.retentionPolicy.listOverrides(query);
  }
}
