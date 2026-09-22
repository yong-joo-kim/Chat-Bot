import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AUDIT_LIMITS,
  BulkDeleteDto,
  CreateFaqDto,
  FaqCategory,
  FaqEntry,
  FaqListQuery,
  FaqListResponse,
  FaqPublicSuggestion,
  FaqSuggestQuery,
  FaqSuggestion,
  IMPORT_LIMITS,
  ImportCommitRequestDto,
  ImportCommitResult,
  ImportRowError,
  ImportValidateResult,
  UpdateFaqDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { suggestSimilarFaqs } from '@chat-bot/dialogue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import type { ImportStagingStore } from '../dialogue-common/import/import-staging.store';
import { CsvSheetReader } from '../dialogue-common/import/csv-sheet-reader';
import { XlsxSheetReader } from '../dialogue-common/import/xlsx-sheet-reader';
import { ImportFileTooLargeError } from '../dialogue-common/import/sheet-reader';
import type { SheetReader } from '../dialogue-common/import/sheet-reader';
import { hasEncodingAnomaly, isHeaderMismatch } from '../dialogue-common/import/lib/sheet-detect';
import { parseFaqRows } from '../dialogue-common/import/lib/import-row-parser';
import { ExistingFaqRecord, FaqPlan, planFaqImport } from '../dialogue-common/import/lib/import-planner';
import { buildCsv, FAQ_TEMPLATE_HEADERS } from '../dialogue-common/import/lib/csv-writer';
import { buildXlsxTemplate } from '../dialogue-common/import/lib/xlsx-writer';
import { toFaqEntity } from './faq.mapper';
import { dedupeAltQuestions, findDuplicateFaqOwner } from './lib/alt-question-set';
import type { UploadedFile } from '../intents/intents.service';

const NOT_FOUND_MESSAGE = '요청하신 FAQ를 찾을 수 없습니다.';
const FAQ_CATEGORIES: FaqCategory[] = ['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE'];

interface StagedFaqPayload {
  plan: FaqPlan;
  errors: ImportRowError[];
}

@Injectable()
export class FaqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    @Inject('ImportStagingStore') private readonly stagingStore: ImportStagingStore,
    private readonly csvReader: CsvSheetReader,
    private readonly xlsxReader: XlsxSheetReader,
  ) {}

  private toAuditSnapshot(row: { id: string; question: string; category: string; enabled: boolean; altQuestions: string }) {
    return { ...row, altQuestionCount: this.parseAltQuestionsJson(row.altQuestions).length };
  }

  private async assertNotDuplicate(chatbotId: string, question: string, altQuestions: string[], excludeId?: string): Promise<void> {
    const others = await this.prisma.faqEntry.findMany({
      where: { chatbotId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, question: true, altQuestions: true },
    });
    const owner = findDuplicateFaqOwner(
      excludeId,
      question,
      altQuestions,
      others.map((o) => ({ id: o.id, question: o.question, altQuestions: this.parseAltQuestionsJson(o.altQuestions) })),
    );
    if (owner) {
      throw new ApiException('DUPLICATE_FAQ', 409, `이미 같은 질문이 등록되어 있습니다: "${owner.question}"`);
    }
  }

  private parseAltQuestionsJson(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  async create(chatbotId: string, dto: CreateFaqDto): Promise<FaqEntry> {
    await this.scope.assertWritable(chatbotId);
    const question = dto.question.trim();
    const { altQuestions } = dedupeAltQuestions(dto.altQuestions ?? [], question);
    await this.assertNotDuplicate(chatbotId, question, altQuestions);

    const row = await this.prisma.faqEntry.create({
      data: {
        chatbotId,
        category: dto.category,
        question,
        questionNormalized: normalizeText(question),
        answer: dto.answer,
        altQuestions: JSON.stringify(altQuestions),
        enabled: dto.enabled ?? true,
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'FaqEntry',
      targetId: row.id,
      targetName: row.question,
      chatbotId,
      after: this.toAuditSnapshot(row),
    });
    return toFaqEntity(row);
  }

  async list(chatbotId: string, query: FaqListQuery): Promise<FaqListResponse> {
    await this.scope.assertReadable(chatbotId);
    const baseWhere: Prisma.FaqEntryWhereInput = { chatbotId };
    if (query.q) baseWhere.OR = [{ question: { contains: query.q } }, { answer: { contains: query.q } }];
    if (query.enabled !== undefined) baseWhere.enabled = query.enabled;

    const where: Prisma.FaqEntryWhereInput = { ...baseWhere };
    if (query.category && query.category.length > 0) where.category = { in: query.category };

    const orderBy = { [query.sort === 'name' ? 'question' : query.sort]: query.order } as Prisma.FaqEntryOrderByWithRelationInput;

    const [rows, total, groupCounts] = await Promise.all([
      this.prisma.faqEntry.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.faqEntry.count({ where }),
      this.prisma.faqEntry.groupBy({ by: ['category'], where: baseWhere, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(FAQ_CATEGORIES.map((c) => [c, 0])) as Record<FaqCategory, number>;
    for (const g of groupCounts) counts[g.category as FaqCategory] = g._count._all;

    return { items: rows.map(toFaqEntity), total, page: query.page, pageSize: query.pageSize, counts };
  }

  async suggest(chatbotId: string, query: FaqSuggestQuery): Promise<FaqSuggestion[] | FaqPublicSuggestion[]> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.faqEntry.findMany({
      where: { chatbotId, ...(query.mode === 'public' ? { enabled: true } : {}) },
    });
    const faqs = rows.map(toFaqEntity);
    const suggestions = suggestSimilarFaqs(query.q, faqs, query.limit);

    if (query.mode === 'public') {
      return suggestions.map((s) => ({ id: s.id, question: s.question }));
    }
    return suggestions;
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.faqEntry.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<FaqEntry> {
    await this.scope.assertReadable(chatbotId);
    return toFaqEntity(await this.findRowOrThrow(chatbotId, id));
  }

  async update(chatbotId: string, id: string, dto: UpdateFaqDto): Promise<FaqEntry> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    const question = dto.question !== undefined ? dto.question.trim() : current.question;
    let altQuestions = this.parseAltQuestionsJson(current.altQuestions);
    if (dto.altQuestions !== undefined || dto.question !== undefined) {
      altQuestions = dedupeAltQuestions(dto.altQuestions ?? altQuestions, question).altQuestions;
    }
    if (dto.question !== undefined || dto.altQuestions !== undefined) {
      await this.assertNotDuplicate(chatbotId, question, altQuestions, id);
    }

    const row = await this.prisma.faqEntry.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.question !== undefined ? { question, questionNormalized: normalizeText(question) } : {}),
        ...(dto.answer !== undefined ? { answer: dto.answer } : {}),
        ...(dto.altQuestions !== undefined || dto.question !== undefined ? { altQuestions: JSON.stringify(altQuestions) } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'FaqEntry',
      targetId: row.id,
      targetName: row.question,
      chatbotId,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(row),
    });
    return toFaqEntity(row);
  }

  /** 참조 제약이 없으므로 항상 허용한다(FR-9-10). */
  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.prisma.faqEntry.delete({ where: { id } });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'FaqEntry',
      targetId: current.id,
      targetName: current.question,
      chatbotId,
      before: this.toAuditSnapshot(current),
    });
  }

  async bulkDelete(chatbotId: string, dto: BulkDeleteDto): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const rows = await this.prisma.faqEntry.findMany({ where: { chatbotId, id: { in: dto.ids } } });
    if (rows.length !== dto.ids.length) throw new ApiException('NOT_FOUND', 404, '일부 FAQ를 찾을 수 없습니다.');
    await this.prisma.faqEntry.deleteMany({ where: { chatbotId, id: { in: dto.ids } } });
    this.bundleService.invalidate(chatbotId);

    const targetIds = dto.ids.slice(0, AUDIT_LIMITS.bulkTargetIds);
    await this.auditLogService.record({
      action: 'BULK_DELETE',
      targetType: 'FaqEntry',
      targetId: rows[0]?.id ?? '-',
      chatbotId,
      after: { deleted: rows.length, targetIds, truncated: dto.ids.length > targetIds.length },
      summary: `일괄 삭제 / FAQ / ${rows.length}건`,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // 대량 업로드(FR-9-9)
  // ---------------------------------------------------------------------------------------------

  private pickReader(filename: string): SheetReader {
    return filename.toLowerCase().endsWith('.xlsx') ? this.xlsxReader : this.csvReader;
  }

  private assertFileBasics(file: UploadedFile): void {
    const lower = file.originalname.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, '.xlsx 또는 .csv 파일만 업로드할 수 있습니다.');
    }
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      throw new ApiException('IMPORT_TOO_LARGE', 400, `파일은 최대 ${IMPORT_LIMITS.maxFileBytes / (1024 * 1024)}MB까지 올릴 수 있습니다.`);
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
        { canonical: '분류', aliases: ['category'] },
        { canonical: '질문', aliases: ['question'] },
        { canonical: '답변', aliases: ['answer'] },
      ])
    ) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, '헤더 형식이 템플릿과 다릅니다. 템플릿을 내려받아 다시 시도해 주세요.');
    }
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) throw new ApiException('IMPORT_FILE_INVALID', 400, '데이터 행이 없습니다.');
    if (hasEncodingAnomaly(dataRows)) throw new ApiException('IMPORT_FILE_INVALID', 400, 'UTF-8로 저장 후 다시 업로드해 주세요.');

    const { parsed, errors } = parseFaqRows(dataRows);

    const existingRows = await this.prisma.faqEntry.findMany({
      where: { chatbotId },
      select: { id: true, question: true, questionNormalized: true, altQuestions: true },
    });
    const existing: ExistingFaqRecord[] = existingRows.map((r) => ({
      id: r.id,
      question: r.question,
      questionNormalized: r.questionNormalized,
      altQuestions: this.parseAltQuestionsJson(r.altQuestions),
    }));

    const plan = planFaqImport(parsed, existing);

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_LIMITS.tokenTtlMs);
    this.stagingStore.set(token, { chatbotId, resourceType: 'FAQ', plan: { plan, errors } satisfies StagedFaqPayload, expiresAt });

    return {
      importToken: token,
      expiresAt,
      resourceType: 'FAQ',
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
    if (!staged || staged.chatbotId !== chatbotId || staged.resourceType !== 'FAQ') {
      throw new ApiException('IMPORT_TOKEN_EXPIRED', 400, '검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요.');
    }
    const { plan, errors } = staged.plan as StagedFaqPayload;

    if (dto.errorPolicy === 'ABORT_ON_ERROR' && errors.length > 0) {
      throw new ApiException('IMPORT_ABORTED', 400, `오류 ${errors.length}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다.`);
    }

    let createdItems = 0;
    let updatedItems = 0;
    let createdValues = 0;
    const targetIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of plan.items) {
        if (item.existingId) {
          if (dto.mergePolicy === 'SKIP') continue;
          const current = await tx.faqEntry.findUnique({ where: { id: item.existingId } });
          if (!current) continue;
          const currentAlt = this.parseAltQuestionsJson(current.altQuestions);
          const nextAlt =
            dto.mergePolicy === 'REPLACE' ? item.altQuestions : dedupeAltQuestions([...currentAlt, ...item.altQuestions], item.question).altQuestions;
          await tx.faqEntry.update({
            where: { id: item.existingId },
            data: {
              altQuestions: JSON.stringify(nextAlt.slice(0, 30)),
              ...(item.answer ? { answer: item.answer } : {}),
            },
          });
          updatedItems += 1;
          createdValues += item.altQuestions.length;
          targetIds.push(item.existingId);
        } else {
          const altQuestions = dedupeAltQuestions(item.altQuestions, item.question).altQuestions.slice(0, 30);
          const created = await tx.faqEntry.create({
            data: {
              chatbotId,
              category: item.category,
              question: item.question,
              questionNormalized: item.questionNormalized,
              answer: item.answer,
              altQuestions: JSON.stringify(altQuestions),
              enabled: true,
            },
          });
          createdItems += 1;
          createdValues += altQuestions.length;
          targetIds.push(created.id);
        }
      }
    });
    this.bundleService.invalidate(chatbotId);

    const cappedTargetIds = targetIds.slice(0, AUDIT_LIMITS.bulkTargetIds);
    await this.auditLogService.record({
      action: 'IMPORT',
      targetType: 'FaqEntry',
      targetId: cappedTargetIds[0] ?? '-',
      chatbotId,
      after: { created: createdItems, updated: updatedItems, targetIds: cappedTargetIds, truncated: targetIds.length > cappedTargetIds.length },
      summary: `대량 등록 / FAQ / 신규 ${createdItems}건·갱신 ${updatedItems}건`,
    });

    return { createdItems, updatedItems, createdValues, skippedRows: plan.duplicatedRows + errors.length, errors };
  }

  async importTemplate(format: 'csv' | 'xlsx'): Promise<{ content: Buffer | string; filename: string; mimeType: string }> {
    if (format === 'xlsx') {
      const content = await buildXlsxTemplate(FAQ_TEMPLATE_HEADERS);
      return { content, filename: 'faq-template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    return { content: buildCsv(FAQ_TEMPLATE_HEADERS, []), filename: 'faq-template.csv', mimeType: 'text/csv; charset=utf-8' };
  }

  async export(chatbotId: string): Promise<{ content: string; filename: string; mimeType: string }> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.faqEntry.findMany({ where: { chatbotId } });
    const lines: string[][] = [];
    for (const row of rows) {
      const altQuestions = this.parseAltQuestionsJson(row.altQuestions);
      if (altQuestions.length === 0) {
        lines.push([row.category, row.question, row.answer, '']);
        continue;
      }
      for (const alt of altQuestions) lines.push([row.category, row.question, row.answer, alt]);
    }
    return { content: buildCsv(FAQ_TEMPLATE_HEADERS, lines), filename: 'faqs-export.csv', mimeType: 'text/csv; charset=utf-8' };
  }
}
