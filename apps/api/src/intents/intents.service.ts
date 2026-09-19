import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  BulkDeleteDto,
  CreateIntentDto,
  IMPORT_LIMITS,
  ImportCommitRequestDto,
  ImportCommitResult,
  ImportRowError,
  ImportValidateResult,
  Intent,
  IntentDetail,
  IntentExampleMutationDto,
  IntentListItem,
  IntentListQuery,
  IntentMutationResult,
  Paginated,
  UpdateIntentDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import type { ImportStagingStore } from '../dialogue-common/import/import-staging.store';
import { CsvSheetReader } from '../dialogue-common/import/csv-sheet-reader';
import { XlsxSheetReader } from '../dialogue-common/import/xlsx-sheet-reader';
import { ImportFileTooLargeError } from '../dialogue-common/import/sheet-reader';
import type { SheetReader } from '../dialogue-common/import/sheet-reader';
import { hasEncodingAnomaly, isHeaderMismatch } from '../dialogue-common/import/lib/sheet-detect';
import { parseNameValueRows } from '../dialogue-common/import/lib/import-row-parser';
import { ExistingNameValueRecord, NameValuePlan, planNameValueImport } from '../dialogue-common/import/lib/import-planner';
import { buildCsv, INTENT_TEMPLATE_HEADERS } from '../dialogue-common/import/lib/csv-writer';
import { buildXlsxTemplate } from '../dialogue-common/import/lib/xlsx-writer';
import { toIntentDetail, toIntentEntity, toIntentListItem } from './intent.mapper';
import { dedupeExamples, mergeExampleMutation } from './lib/example-set';
import { findExampleConflicts } from './lib/example-conflict';

const NOT_FOUND_MESSAGE = '요청하신 의도를 찾을 수 없습니다.';
const MAX_EXAMPLES = 500;

interface StagedIntentPayload {
  plan: NameValuePlan;
  errors: ImportRowError[];
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class IntentsService {
  private readonly logger = new Logger('IntentsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly bundleService: DialogueBundleService,
    @Inject('ImportStagingStore') private readonly stagingStore: ImportStagingStore,
    private readonly csvReader: CsvSheetReader,
    private readonly xlsxReader: XlsxSheetReader,
  ) {}

  private parseExamplesJson(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.intent.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (existing) {
      throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 의도가 있습니다.');
    }
  }

  private async computeConflicts(chatbotId: string, intentId: string | undefined, examples: string[]) {
    if (examples.length === 0) return [];
    const others = await this.prisma.intent.findMany({
      where: { chatbotId, ...(intentId ? { id: { not: intentId } } : {}) },
      select: { id: true, name: true, examples: true },
    });
    return findExampleConflicts(
      intentId,
      examples,
      others.map((o) => ({ id: o.id, name: o.name, examples: this.parseExamplesJson(o.examples) })),
    );
  }

  async create(chatbotId: string, dto: CreateIntentDto): Promise<IntentMutationResult> {
    await this.scope.assertWritable(chatbotId);

    const trimmedName = dto.name.trim();
    const nameNormalized = normalizeText(trimmedName);
    await this.assertNameFree(chatbotId, nameNormalized);

    const { examples, deduplicatedCount } = dedupeExamples(dto.examples ?? []);
    if (examples.length > MAX_EXAMPLES) {
      throw new ApiException('LIMIT_EXCEEDED', 400, `예문은 최대 ${MAX_EXAMPLES}개까지 등록할 수 있습니다(현재 ${examples.length}개).`);
    }

    const conflicts = await this.computeConflicts(chatbotId, undefined, examples);

    const row = await this.prisma.intent.create({
      data: {
        chatbotId,
        name: trimmedName,
        nameNormalized,
        description: dto.description,
        examples: JSON.stringify(examples),
      },
    });

    return { intent: toIntentDetail(row, []), meta: { deduplicatedCount, conflicts } };
  }

  async list(chatbotId: string, query: IntentListQuery): Promise<Paginated<IntentListItem>> {
    await this.scope.assertReadable(chatbotId);

    const where: Prisma.IntentWhereInput = { chatbotId };
    if (query.q) {
      where.OR = [{ name: { contains: query.q } }, { description: { contains: query.q } }];
    }
    const orderBy = { [query.sort]: query.order } as Prisma.IntentOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.intent.findMany({
        where,
        include: { _count: { select: { nodeLinks: true } } },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.intent.count({ where }),
    ]);

    return toPaginated(rows.map(toIntentListItem), total, query.page, query.pageSize);
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.intent.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<IntentDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, id);
    const links = await this.prisma.dialogNodeIntent.findMany({
      where: { intentId: id },
      include: { node: { select: { id: true, name: true } } },
    });
    return toIntentDetail(row, links.map((l) => l.node));
  }

  async update(chatbotId: string, id: string, dto: UpdateIntentDto): Promise<IntentMutationResult> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, id);
    }

    let deduplicatedCount = 0;
    let examples = this.parseExamplesJson(current.examples);
    let conflicts: IntentMutationResult['meta']['conflicts'] = [];
    if (dto.examples !== undefined) {
      const deduped = dedupeExamples(dto.examples);
      examples = deduped.examples;
      deduplicatedCount = deduped.deduplicatedCount;
      if (examples.length > MAX_EXAMPLES) {
        throw new ApiException('LIMIT_EXCEEDED', 400, `예문은 최대 ${MAX_EXAMPLES}개까지 등록할 수 있습니다(현재 ${examples.length}개).`);
      }
      conflicts = await this.computeConflicts(chatbotId, id, examples);
    }

    const row = await this.prisma.intent.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.examples !== undefined ? { examples: JSON.stringify(examples) } : {}),
      },
    });

    const links = await this.prisma.dialogNodeIntent.findMany({
      where: { intentId: id },
      include: { node: { select: { id: true, name: true } } },
    });
    return { intent: toIntentDetail(row, links.map((l) => l.node)), meta: { deduplicatedCount, conflicts } };
  }

  async updateExamples(chatbotId: string, id: string, dto: IntentExampleMutationDto): Promise<IntentMutationResult> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    const currentExamples = this.parseExamplesJson(current.examples);

    const { examples, deduplicatedCount } = mergeExampleMutation(currentExamples, dto.add, dto.remove);
    if (examples.length > MAX_EXAMPLES) {
      throw new ApiException('LIMIT_EXCEEDED', 400, `예문은 최대 ${MAX_EXAMPLES}개까지 등록할 수 있습니다(현재 ${examples.length}개).`);
    }
    const conflicts = await this.computeConflicts(chatbotId, id, examples);

    const row = await this.prisma.intent.update({ where: { id }, data: { examples: JSON.stringify(examples) } });
    const links = await this.prisma.dialogNodeIntent.findMany({
      where: { intentId: id },
      include: { node: { select: { id: true, name: true } } },
    });
    return { intent: toIntentDetail(row, links.map((l) => l.node)), meta: { deduplicatedCount, conflicts } };
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    await this.findRowOrThrow(chatbotId, id);
    await this.referenceCheck.assertIntentDeletable(chatbotId, id);
    await this.prisma.intent.delete({ where: { id } });
  }

  async bulkDelete(chatbotId: string, dto: BulkDeleteDto): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const rows = await this.prisma.intent.findMany({ where: { chatbotId, id: { in: dto.ids } } });
    if (rows.length !== dto.ids.length) {
      throw new ApiException('NOT_FOUND', 404, '일부 의도를 찾을 수 없습니다.');
    }

    const blocked: Array<{ id: string; name: string }> = [];
    for (const row of rows) {
      try {
        await this.referenceCheck.assertIntentDeletable(chatbotId, row.id);
      } catch (e) {
        if (e instanceof ApiException) blocked.push({ id: row.id, name: row.name });
        else throw e;
      }
    }
    if (blocked.length > 0) {
      throw new ApiException(
        'INTENT_IN_USE',
        409,
        `${blocked.length}건의 의도가 다른 곳에서 사용 중이라 삭제할 수 없습니다. 전체 삭제가 취소되었습니다.`,
        blocked.map((b) => ({ field: b.id, message: b.name })),
      );
    }

    await this.prisma.intent.deleteMany({ where: { chatbotId, id: { in: dto.ids } } });
  }

  // ---------------------------------------------------------------------------------------------
  // 대량 업로드(FR-6-19~30, ADR-0007)
  // ---------------------------------------------------------------------------------------------

  private pickReader(filename: string): SheetReader {
    return filename.toLowerCase().endsWith('.xlsx') ? this.xlsxReader : this.csvReader;
  }

  private assertFileBasics(file: UploadedFile): void {
    const lower = file.originalname.toLowerCase();
    const extOk = lower.endsWith('.csv') || lower.endsWith('.xlsx');
    if (!extOk) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, '.xlsx 또는 .csv 파일만 업로드할 수 있습니다.');
    }
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      throw new ApiException(
        'IMPORT_TOO_LARGE',
        400,
        `파일은 최대 ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)}MB까지 올릴 수 있습니다.`,
      );
    }
  }

  async importValidate(chatbotId: string, file: UploadedFile): Promise<ImportValidateResult> {
    await this.scope.assertWritable(chatbotId);
    this.assertFileBasics(file);

    const reader = this.pickReader(file.originalname);
    let rows;
    try {
      rows = await reader.read(file.buffer, IMPORT_LIMITS.maxRows);
    } catch (e) {
      if (e instanceof ImportFileTooLargeError) {
        throw new ApiException('IMPORT_TOO_LARGE', 400, `파일은 최대 ${IMPORT_LIMITS.maxRows}행까지 올릴 수 있습니다.`);
      }
      throw e;
    }

    if (rows.length === 0) throw new ApiException('IMPORT_FILE_INVALID', 400, '데이터 행이 없습니다.');
    if (
      isHeaderMismatch(rows[0]?.cells, [
        { canonical: '의도명', aliases: ['intentname', 'intent_name'] },
        { canonical: '예문', aliases: ['example'] },
      ])
    ) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, '헤더 형식이 템플릿과 다릅니다. 템플릿을 내려받아 다시 시도해 주세요.');
    }
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) throw new ApiException('IMPORT_FILE_INVALID', 400, '데이터 행이 없습니다.');
    if (hasEncodingAnomaly(dataRows)) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, 'UTF-8로 저장 후 다시 업로드해 주세요.');
    }

    const { parsed, errors } = parseNameValueRows(dataRows, { nameMax: 100, valueMax: 200 });

    const existingRows = await this.prisma.intent.findMany({
      where: { chatbotId },
      select: { id: true, name: true, nameNormalized: true, examples: true },
    });
    const existing: ExistingNameValueRecord[] = existingRows.map((r) => ({
      id: r.id,
      name: r.name,
      nameNormalized: r.nameNormalized,
      values: this.parseExamplesJson(r.examples),
    }));

    const plan = planNameValueImport(parsed, existing);

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_LIMITS.tokenTtlMs);
    this.stagingStore.set(token, { chatbotId, resourceType: 'INTENT', plan: { plan, errors } satisfies StagedIntentPayload, expiresAt });

    return {
      importToken: token,
      expiresAt,
      resourceType: 'INTENT',
      totalRows: plan.totalRows,
      newItems: plan.newItems,
      updatedItems: plan.updatedItems,
      newValues: plan.newValues,
      duplicatedRows: plan.duplicatedRows,
      errors,
      conflicts: [],
    };
  }

  async importCommit(chatbotId: string, dto: ImportCommitRequestDto): Promise<ImportCommitResult> {
    await this.scope.assertWritable(chatbotId);
    const staged = this.stagingStore.take(dto.importToken);
    if (!staged || staged.chatbotId !== chatbotId || staged.resourceType !== 'INTENT') {
      throw new ApiException('IMPORT_TOKEN_EXPIRED', 400, '검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요.');
    }
    const { plan, errors } = staged.plan as StagedIntentPayload;

    if (dto.errorPolicy === 'ABORT_ON_ERROR' && errors.length > 0) {
      throw new ApiException(
        'IMPORT_ABORTED',
        400,
        `오류 ${errors.length}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다.`,
      );
    }

    let createdItems = 0;
    let updatedItems = 0;
    let createdValues = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const item of plan.items) {
        if (item.existingId) {
          if (dto.mergePolicy === 'SKIP') continue;
          const current = await tx.intent.findUnique({ where: { id: item.existingId } });
          if (!current) continue;
          const currentExamples = this.parseExamplesJson(current.examples);
          const nextExamples =
            dto.mergePolicy === 'REPLACE' ? item.values : dedupeExamples([...currentExamples, ...item.values]).examples;
          const capped = nextExamples.slice(0, MAX_EXAMPLES);
          await tx.intent.update({
            where: { id: item.existingId },
            data: { examples: JSON.stringify(capped), ...(item.description ? { description: item.description } : {}) },
          });
          updatedItems += 1;
          createdValues += item.values.length;
        } else {
          const capped = item.values.slice(0, MAX_EXAMPLES);
          await tx.intent.create({
            data: {
              chatbotId,
              name: item.name,
              nameNormalized: item.nameNormalized,
              description: item.description,
              examples: JSON.stringify(capped),
            },
          });
          createdItems += 1;
          createdValues += capped.length;
        }
      }
    });

    return { createdItems, updatedItems, createdValues, skippedRows: plan.duplicatedRows + errors.length, errors };
  }

  async importTemplate(format: 'csv' | 'xlsx'): Promise<{ content: Buffer | string; filename: string; mimeType: string }> {
    if (format === 'xlsx') {
      const content = await buildXlsxTemplate(INTENT_TEMPLATE_HEADERS);
      return {
        content,
        filename: 'intent-template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return { content: buildCsv(INTENT_TEMPLATE_HEADERS, []), filename: 'intent-template.csv', mimeType: 'text/csv; charset=utf-8' };
  }

  async export(chatbotId: string): Promise<{ content: string; filename: string; mimeType: string }> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.intent.findMany({ where: { chatbotId } });
    const lines: string[][] = [];
    for (const row of rows) {
      const examples = this.parseExamplesJson(row.examples);
      if (examples.length === 0) {
        lines.push([row.name, '', row.description ?? '']);
        continue;
      }
      for (const example of examples) {
        lines.push([row.name, example, row.description ?? '']);
      }
    }
    return {
      content: buildCsv(INTENT_TEMPLATE_HEADERS, lines),
      filename: 'intents-export.csv',
      mimeType: 'text/csv; charset=utf-8',
    };
  }
}
