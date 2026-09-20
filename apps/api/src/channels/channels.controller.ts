import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common';
import { ChannelListItem, ChannelType, UpdateChannelDto, UpdateChannelSchema } from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodParamPipe } from '../common/zod-param.pipe';
import { PermissionGuard } from '../common/auth/permission.guard';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { ChannelsService } from './channels.service';

@UseGuards(PermissionGuard)
@Controller('chatbots/:chatbotId/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @RequirePermission('channel:read')
  list(@Param('chatbotId') chatbotId: string): Promise<{ items: ChannelListItem[] }> {
    return this.channelsService.list(chatbotId);
  }

  @Patch(':type')
  @RequirePermission('channel:write')
  upsert(
    @Param('chatbotId') chatbotId: string,
    @Param('type', new ZodParamPipe(ChannelType)) type: ChannelType,
    @Body(new ZodValidationPipe(UpdateChannelSchema)) dto: UpdateChannelDto,
  ): Promise<ChannelListItem> {
    return this.channelsService.upsert(chatbotId, type, dto);
  }

  @Delete(':type')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('channel:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('type', new ZodParamPipe(ChannelType)) type: ChannelType): Promise<void> {
    await this.channelsService.remove(chatbotId, type);
  }
}
