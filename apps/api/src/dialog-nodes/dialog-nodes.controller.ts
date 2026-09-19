import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CopyDialogNodeDto,
  CopyDialogNodeSchema,
  CreateDialogNodeDto,
  CreateDialogNodeSchema,
  DesignValidationReport,
  DialogNode,
  DialogNodeListItem,
  DialogNodeListQuery,
  DialogNodeListQuerySchema,
  FlowTree,
  Paginated,
  UpdateDialogNodeDto,
  UpdateDialogNodeSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { DialogNodesService } from './dialog-nodes.service';

@UseGuards(PermissionGuard)
@Controller('chatbots/:chatbotId/dialog-nodes')
export class DialogNodesController {
  constructor(private readonly dialogNodesService: DialogNodesService) {}

  @Post()
  @RequirePermission('dialogue:write')
  create(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CreateDialogNodeSchema)) dto: CreateDialogNodeDto,
  ): Promise<DialogNode> {
    return this.dialogNodesService.create(chatbotId, dto);
  }

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(DialogNodeListQuerySchema)) query: DialogNodeListQuery,
  ): Promise<Paginated<DialogNodeListItem>> {
    return this.dialogNodesService.list(chatbotId, query);
  }

  @Get('flow')
  @RequirePermission('dialogue:read')
  flow(@Param('chatbotId') chatbotId: string): Promise<FlowTree> {
    return this.dialogNodesService.flow(chatbotId);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('dialogue:read')
  validate(@Param('chatbotId') chatbotId: string): Promise<DesignValidationReport> {
    return this.dialogNodesService.validate(chatbotId);
  }

  @Get(':id')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<DialogNode> {
    return this.dialogNodesService.findOne(chatbotId, id);
  }

  @Patch(':id')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDialogNodeSchema)) dto: UpdateDialogNodeDto,
  ): Promise<DialogNode> {
    return this.dialogNodesService.update(chatbotId, id, dto);
  }

  @Post(':id/copy')
  @RequirePermission('dialogue:write')
  copy(
    @Param('chatbotId') chatbotId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CopyDialogNodeSchema)) dto: CopyDialogNodeDto,
  ): Promise<DialogNode> {
    return this.dialogNodesService.copy(chatbotId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('id') id: string): Promise<void> {
    await this.dialogNodesService.remove(chatbotId, id);
  }
}
