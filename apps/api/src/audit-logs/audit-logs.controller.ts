import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AuditChainVerifyRequestDto,
  AuditChainVerifyRequestSchema,
  AuditChainVerifyResponse,
  AuditLogDetail,
  AuditLogListQuery,
  AuditLogListQuerySchema,
  AuditLogListResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { AuditView } from './access/audit-view.decorator';
import { AuditLogsService } from './audit-logs.service';
import { AuditChainVerifier, AuditRangeTooWideError, InvalidAuditRangeError } from './chain/audit-chain-verifier.service';
import { ApiException } from '../common/api.exception';

/**
 * 이력 조회(No.13). 쓰기·수정·삭제 경로가 존재하지 않는다(append-only, FR-13-14/20 —
 * 이 컨트롤러에 `Patch`/`Delete` import가 없어야 한다, code-reviewer 점검 항목).
 * `/export`를 `/:id`보다 먼저 선언한다(라우트 선언 순서 주의, `chatbots.controller.ts` 선례).
 * [신규 No.45] `POST /verify`(체인 검증) · `list`·`findOne`에 `@AuditView`(모드 ON에서만 기록).
 */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(
    private readonly auditLogsService: AuditLogsService,
    private readonly chainVerifier: AuditChainVerifier,
  ) {}

  @Get()
  @RequirePermission('audit:read')
  @AuditView({ targetType: 'AuditLog' })
  list(@Query(new ZodQueryPipe(AuditLogListQuerySchema)) query: AuditLogListQuery): Promise<AuditLogListResponse> {
    return this.auditLogsService.list(query);
  }

  @Get('export')
  @RequirePermission('audit:read')
  @Header('Cache-Control', 'no-store')
  async export(@Query(new ZodQueryPipe(AuditLogListQuerySchema)) query: AuditLogListQuery, @Res() res: Response): Promise<void> {
    const { content, filename, mimeType } = await this.auditLogsService.export(query);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  @Post('verify')
  @RequirePermission('audit:read')
  async verify(@Body(new ZodValidationPipe(AuditChainVerifyRequestSchema)) dto: AuditChainVerifyRequestDto): Promise<AuditChainVerifyResponse> {
    try {
      return await this.chainVerifier.verify(dto.from, dto.to);
    } catch (e) {
      if (e instanceof AuditRangeTooWideError) throw new ApiException('AUDIT_RANGE_TOO_WIDE', 400, e.message);
      if (e instanceof InvalidAuditRangeError) throw new ApiException('INVALID_PERIOD', 400, e.message);
      throw e;
    }
  }

  @Get(':id')
  @RequirePermission('audit:read')
  @AuditView({ targetType: 'AuditLog', idParam: 'id' })
  findOne(@Param('id') id: string): Promise<AuditLogDetail> {
    return this.auditLogsService.findOne(id);
  }
}
