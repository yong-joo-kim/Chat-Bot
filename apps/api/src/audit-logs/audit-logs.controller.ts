import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditLogDetail, AuditLogListQuery, AuditLogListQuerySchema, AuditLogListResponse } from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { AuditLogsService } from './audit-logs.service';

/**
 * 이력 조회(No.13). 쓰기·수정·삭제 경로가 존재하지 않는다(append-only, FR-13-14/20 —
 * 이 컨트롤러에 `Patch`/`Delete` import가 없어야 한다, code-reviewer 점검 항목).
 * `/export`를 `/:id`보다 먼저 선언한다(라우트 선언 순서 주의, `chatbots.controller.ts` 선례).
 */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RequirePermission('audit:read')
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

  @Get(':id')
  @RequirePermission('audit:read')
  findOne(@Param('id') id: string): Promise<AuditLogDetail> {
    return this.auditLogsService.findOne(id);
  }
}
