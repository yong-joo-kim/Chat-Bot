import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  BannedWord,
  BannedWordListQuery,
  BannedWordListQuerySchema,
  BannedWordTestRequestDto,
  BannedWordTestRequestSchema,
  BannedWordTestResponse,
  CreateBannedWordDto,
  CreateBannedWordSchema,
  Paginated,
  UpdateBannedWordDto,
  UpdateBannedWordSchema,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { BannedWordsService } from './banned-words.service';

/** 금지어/비속어 사전(No.12-d). 권한은 `security:read`/`security:write`다(FR-12-35). */
@Controller('banned-words')
export class BannedWordsController {
  constructor(private readonly bannedWordsService: BannedWordsService) {}

  @Get()
  @RequirePermission('security:read')
  list(@Query(new ZodQueryPipe(BannedWordListQuerySchema)) query: BannedWordListQuery): Promise<Paginated<BannedWord>> {
    return this.bannedWordsService.list(query);
  }

  @Post()
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateBannedWordSchema)) dto: CreateBannedWordDto): Promise<BannedWord> {
    return this.bannedWordsService.create(dto);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('security:read')
  test(@Body(new ZodValidationPipe(BannedWordTestRequestSchema)) dto: BannedWordTestRequestDto): Promise<BannedWordTestResponse> {
    return this.bannedWordsService.test(dto.text);
  }

  @Patch(':id')
  @RequirePermission('security:write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateBannedWordSchema)) dto: UpdateBannedWordDto): Promise<BannedWord> {
    return this.bannedWordsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('security:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.bannedWordsService.remove(id);
  }
}
