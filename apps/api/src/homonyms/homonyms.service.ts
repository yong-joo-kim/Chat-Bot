import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateHomonymDto,
  DialogOutput,
  HomonymDictionary,
  HomonymListItem,
  HomonymListQuery,
  Paginated,
  TraceStep,
  UpdateHomonymDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { resolveHomonym, buildClarifyOutput } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { toHomonymEntity, toHomonymListItem } from './homonym.mapper';
import { findInvalidIntentIds } from './lib/meaning-validation';

const NOT_FOUND_MESSAGE = '요청하신 동음이의어 사전 항목을 찾을 수 없습니다.';

@Injectable()
export class HomonymsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
  ) {}

  private async assertWordFree(chatbotId: string, wordNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.homonymDictionary.findFirst({
      where: { chatbotId, wordNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 단어의 동음이의어 항목이 있습니다.');
  }

  private async assertIntentRefsValid(chatbotId: string, dto: Pick<CreateHomonymDto, 'meanings'>): Promise<void> {
    const intentIds = dto.meanings.map((m) => m.intentId).filter((id): id is string => !!id);
    if (intentIds.length === 0) return;
    const found = await this.prisma.intent.findMany({ where: { chatbotId, id: { in: intentIds } }, select: { id: true } });
    const invalid = findInvalidIntentIds(dto.meanings, new Set(found.map((f) => f.id)));
    if (invalid.length > 0) {
      throw new ApiException('INVALID_REFERENCE', 404, '선택한 의도를 찾을 수 없습니다.', invalid.map((id) => ({ field: 'meanings.intentId', message: id })));
    }
  }

  async create(chatbotId: string, dto: CreateHomonymDto): Promise<HomonymDictionary> {
    await this.scope.assertWritable(chatbotId);
    const wordNormalized = normalizeText(dto.word);
    await this.assertWordFree(chatbotId, wordNormalized);
    await this.assertIntentRefsValid(chatbotId, dto);

    const row = await this.prisma.homonymDictionary.create({
      data: {
        chatbotId,
        word: dto.word.trim(),
        wordNormalized,
        description: dto.description,
        meanings: JSON.stringify(dto.meanings),
        policy: dto.policy,
        clarifyPrompt: dto.clarifyPrompt,
        defaultMeaningIndex: dto.defaultMeaningIndex ?? undefined,
      },
    });
    return toHomonymEntity(row);
  }

  async list(chatbotId: string, query: HomonymListQuery): Promise<Paginated<HomonymListItem>> {
    await this.scope.assertReadable(chatbotId);
    const where: Prisma.HomonymDictionaryWhereInput = { chatbotId };
    if (query.q) where.OR = [{ word: { contains: query.q } }, { description: { contains: query.q } }];
    const orderBy = { [query.sort === 'name' ? 'word' : query.sort]: query.order } as Prisma.HomonymDictionaryOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.homonymDictionary.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.homonymDictionary.count({ where }),
    ]);
    return toPaginated(rows.map(toHomonymListItem), total, query.page, query.pageSize);
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.homonymDictionary.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<HomonymDictionary> {
    await this.scope.assertReadable(chatbotId);
    return toHomonymEntity(await this.findRowOrThrow(chatbotId, id));
  }

  async update(chatbotId: string, id: string, dto: UpdateHomonymDto): Promise<HomonymDictionary> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    let word = current.word;
    let wordNormalized = current.wordNormalized;
    if (dto.word !== undefined) {
      word = dto.word.trim();
      wordNormalized = normalizeText(word);
      await this.assertWordFree(chatbotId, wordNormalized, id);
    }
    if (dto.meanings !== undefined) {
      await this.assertIntentRefsValid(chatbotId, { meanings: dto.meanings });
    }

    const row = await this.prisma.homonymDictionary.update({
      where: { id },
      data: {
        word,
        wordNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.meanings !== undefined ? { meanings: JSON.stringify(dto.meanings) } : {}),
        ...(dto.policy !== undefined ? { policy: dto.policy } : {}),
        ...(dto.clarifyPrompt !== undefined ? { clarifyPrompt: dto.clarifyPrompt } : {}),
        ...(dto.defaultMeaningIndex !== undefined ? { defaultMeaningIndex: dto.defaultMeaningIndex } : {}),
      },
    });
    return toHomonymEntity(row);
  }

  /** 다른 리소스가 사전 항목을 참조하지 않으므로 항상 허용한다(FR-7-9). */
  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    await this.findRowOrThrow(chatbotId, id);
    await this.prisma.homonymDictionary.delete({ where: { id } });
  }

  /** 테스트 입력란(FR-7-11) — 엔진의 `resolveHomonym`만 호출한다(노드/FAQ 매칭 없음). */
  async test(chatbotId: string, text: string): Promise<{ resolution: unknown; outputs: DialogOutput[]; trace: TraceStep[] }> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.homonymDictionary.findMany({ where: { chatbotId } });
    const homonyms = rows.map(toHomonymEntity);
    const norm = normalizeText(text);

    const evaluation = resolveHomonym(norm, homonyms);
    const trace: TraceStep[] = [];
    let outputs: DialogOutput[] = [];

    if (evaluation.resolution?.status === 'RESOLVED') {
      trace.push({ stage: 'HOMONYM', code: 'HOMONYM_RESOLVED', targetId: evaluation.homonymId, message: evaluation.resolution.meaningLabel });
    } else if (evaluation.resolution?.status === 'AMBIGUOUS') {
      trace.push({ stage: 'HOMONYM', code: 'HOMONYM_AMBIGUOUS', targetId: evaluation.homonymId });
      if (!evaluation.policy || evaluation.policy === 'ASK') outputs = [buildClarifyOutput(evaluation)];
    } else if (evaluation.resolution?.status === 'IGNORED') {
      trace.push({ stage: 'HOMONYM', code: 'HOMONYM_IGNORED', targetId: evaluation.homonymId });
    }

    return { resolution: evaluation.resolution ?? null, outputs, trace };
  }
}
