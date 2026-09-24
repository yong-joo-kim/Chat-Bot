import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiConnection,
  ApiConnectionListItem,
  ApiConnectionPickerResponse,
  ApiConnectionSamplesResponse,
  ApiConnectionTestRequestDto,
  ApiConnectionTestRequestSchema,
  ApiConnectionTestResult,
  CreateApiConnectionDto,
  CreateApiConnectionSchema,
  UpdateApiConnectionDto,
  UpdateApiConnectionSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ApiConnectionsService } from './api-connections.service';
import { ApiConnectionCatalogService } from './catalog/api-connection-catalog.service';

/** [No.26] API 연결 레지스트리 관리(§12.1). ⚠ `picker`는 `:id`보다 먼저 선언해야 한다. */
@Controller('api-connections')
export class ApiConnectionsController {
  constructor(
    private readonly service: ApiConnectionsService,
    private readonly catalog: ApiConnectionCatalogService,
  ) {}

  @Get()
  @RequirePermission('security:read')
  async list(): Promise<{ items: ApiConnectionListItem[] }> {
    return this.service.list();
  }

  @Get('picker')
  @RequirePermission('dialogue:read')
  async picker(): Promise<ApiConnectionPickerResponse> {
    return { items: await this.catalog.pickerItems() };
  }

  @Post()
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateApiConnectionSchema)) dto: CreateApiConnectionDto): Promise<ApiConnection> {
    return this.service.create(dto);
  }

  @Get(':id')
  @RequirePermission('security:read')
  findOne(@Param('id') id: string): Promise<ApiConnection> {
    return this.service.findOne(id);
  }

  @Get(':id/samples')
  @RequirePermission('dialogue:read')
  samples(@Param('id') id: string): Promise<ApiConnectionSamplesResponse> {
    return this.service.samples(id);
  }

  @Patch(':id')
  @RequirePermission('security:write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateApiConnectionSchema)) dto: UpdateApiConnectionDto): Promise<ApiConnection> {
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
  @HttpCode(HttpStatus.OK)
  test(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApiConnectionTestRequestSchema)) dto: ApiConnectionTestRequestDto,
  ): Promise<ApiConnectionTestResult> {
    return this.service.test(id, dto);
  }
}
