import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  CreateWorkflowTargetDto,
  CreateWorkflowTargetSchema,
  UpdateWorkflowTargetDto,
  UpdateWorkflowTargetSchema,
  WorkflowTarget,
  WorkflowTargetPickerResponse,
  WorkflowTestSendRequestDto,
  WorkflowTestSendRequestSchema,
  WorkflowTestSendResult,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { WorkflowTargetsService } from './workflow-targets.service';
import { WorkflowTestSendService } from './workflow-test-send.service';
import { WorkflowCatalogService } from '../catalog/workflow-catalog.service';

/** [신규 No.41] 업무 자동화 발송 대상 관리(§12.1). ⚠ `picker`는 `:id`보다 먼저 선언해야 한다. */
@Controller('workflow-targets')
export class WorkflowTargetsController {
  constructor(
    private readonly service: WorkflowTargetsService,
    private readonly testSend: WorkflowTestSendService,
    private readonly catalog: WorkflowCatalogService,
  ) {}

  @Get()
  @RequirePermission('security:read')
  list(): Promise<{ items: WorkflowTarget[] }> {
    return this.service.list();
  }

  @Get('picker')
  @RequirePermission('dialogue:read')
  async picker(): Promise<WorkflowTargetPickerResponse> {
    return { items: await this.catalog.picker() };
  }

  @Post()
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateWorkflowTargetSchema)) dto: CreateWorkflowTargetDto): Promise<WorkflowTarget> {
    return this.service.create(dto);
  }

  @Get(':id')
  @RequirePermission('security:read')
  findOne(@Param('id') id: string): Promise<WorkflowTarget> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('security:write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateWorkflowTargetSchema)) dto: UpdateWorkflowTargetDto): Promise<WorkflowTarget> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }

  @Post(':id/test')
  @RequirePermission('security:write')
  test(@Param('id') id: string, @Body(new ZodValidationPipe(WorkflowTestSendRequestSchema)) dto: WorkflowTestSendRequestDto): Promise<WorkflowTestSendResult> {
    return this.testSend.send(id, dto);
  }

  @Post(':id/pause')
  @RequirePermission('security:write')
  pause(@Param('id') id: string): Promise<WorkflowTarget> {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  @RequirePermission('security:write')
  resume(@Param('id') id: string): Promise<WorkflowTarget> {
    return this.service.resume(id);
  }
}
