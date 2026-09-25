import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AUDIT_LIMITS,
  BulkDeleteDto,
  CreateKeywordDto,
  IMPORT_LIMITS,
  ImportCommitRequestDto,
  ImportCommitResult,
  ImportRowError,
  ImportValidateResult,
  Keyword,
  KeywordDetail,
  KeywordListItem,
  KeywordListQuery,
  Paginated,
  UpdateKeywordDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ReferenceCheckService } from '../dialogue-common/reference-check.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
import type { ImportStagingStore } from '../dialogue-common/import/import-staging.store';
import { CsvSheetReader } from '../dialogue-common/import/csv-sheet-reader';
import { XlsxSheetReader } from '../dialogue-common/import/xlsx-sheet-reader';
import { ImportFileTooLargeError } from '../dialogue-common/import/sheet-reader';
import type { SheetReader } from '../dialogue-common/import/sheet-reader';
import { hasEncodingAnomaly, isHeaderMismatch } from '../dialogue-common/import/lib/sheet-detect';
import { parseNameValueRows } from '../dialogue-common/import/lib/import-row-parser';
import {
  ExistingNameValueRecord,
  NameValuePlan,
  conflictsToRowErrors,
  findSynonymConflicts,
  planNameValueImport,
} from '../dialogue-common/import/lib/import-planner';
import { buildCsv, KEYWORD_TEMPLATE_HEADERS } from '../dialogue-common/import/lib/csv-writer';
import { buildXlsxTemplate } from '../dialogue-common/import/lib/xlsx-writer';
import { toKeywordDetail, toKeywordEntity, toKeywordListItem } from './keyword.mapper';
import { dedupeSynonyms, findSynonymConflict } from './lib/synonym-set';
import type { UploadedFile } from '../intents/intents.service';
import { TopicLookupService } from '../topics/topic-lookup.service';
import { buildTopicIdsWhere } from '../topics/lib/topic-query-filter';

const NOT_FOUND_MESSAGE = '요청하신 키워드를 찾을 수 없습니다.';
const MAX_SYNONYMS = 200;

interface StagedKeywordPayload {
  plan: NameValuePlan;
  errors: ImportRowError[];
}

@Injectable()
export class KeywordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly referenceCheck: ReferenceCheckService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    @Inject('ImportStagingStore') private readonly stagingStore: ImportStagingStore,
    private readonly csvReader: CsvSheetReader,
    private readonly xlsxReader: XlsxSheetReader,
    private readonly versionCapture: VersionCaptureService,
    private readonly topicLookup: TopicLookupService,
  ) {}

  private toAuditSnapshot(row: { id: string; name: string; description: string | null; synonyms: string; topicId?: string | null }) {
    const { topicId, ...rest } = row;
    return { ...rest, synonymCount: this.parseSynonymsJson(row.synonyms).length, ...(topicId ? { topicId } : {}) };
  }

  private parseSynonymsJson(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async assertNameFree(chatbotId: string, nameNormalized: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.keyword.findFirst({
      where: { chatbotId, nameNormalized, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, topic: { select: { name: true } } },
    });
    if (existing) {
      const suffix = existing.topic ? `(토픽: ${existing.topic.name})` : '';
      throw new ApiException('DUPLICATE_NAME', 409, `이미 같은 이름의 키워드가 있습니다.${suffix}`);
    }
  }

  private async assertSynonymFree(chatbotId: string, name: string, synonyms: string[], excludeId?: string): Promise<void> {
    const others = await this.prisma.keyword.findMany({
      where: { chatbotId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true, synonyms: true, topic: { select: { name: true } } },
    });
    const conflict = findSynonymConflict(
      excludeId,
      name,
      synonyms,
      others.map((o) => ({ id: o.id, name: o.name, synonyms: this.parseSynonymsJson(o.synonyms) })),
    );
    if (conflict) {
      // [신규 No.22 — §7.5] 상대 키워드의 토픽 이름을 덧붙인다.
      const owner = others.find((o) => o.name === conflict.conflictKeywordName);
      const suffix = owner?.topic ? `(토픽: ${owner.topic.name})` : '';
      throw new ApiException(
        'SYNONYM_CONFLICT',
        409,
        `동의어 '${conflict.term}'은(는) 키워드 '${conflict.conflictKeywordName}'${suffix}에서 이미 사용 중입니다.`,
      );
    }
  }

  async create(chatbotId: string, dto: CreateKeywordDto): Promise<KeywordDetail> {
    await this.scope.assertWritable(chatbotId);
    const trimmedName = dto.name.trim();
    const nameNormalized = normalizeText(trimmedName);
    await this.assertNameFree(chatbotId, nameNormalized);
    if (dto.topicId) await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);

    const { synonyms } = dedupeSynonyms(dto.synonyms ?? []);
    if (synonyms.length > MAX_SYNONYMS) {
      throw new ApiException('LIMIT_EXCEEDED', 400, `동의어는 최대 ${MAX_SYNONYMS}개까지 등록할 수 있습니다(현재 ${synonyms.length}개).`);
    }
    await this.assertSynonymFree(chatbotId, trimmedName, synonyms);

    const row = await this.prisma.keyword.create({
      data: { chatbotId, name: trimmedName, nameNormalized, description: dto.description, synonyms: JSON.stringify(synonyms), topicId: dto.topicId ?? undefined },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'Keyword',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      after: this.toAuditSnapshot(row),
    });
    return toKeywordDetail(row, []);
  }

  async list(chatbotId: string, query: KeywordListQuery): Promise<Paginated<KeywordListItem>> {
    await this.scope.assertReadable(chatbotId);
    const where: Prisma.KeywordWhereInput = { chatbotId };
    const andConditions: Prisma.KeywordWhereInput[] = [];
    if (query.q) andConditions.push({ OR: [{ name: { contains: query.q } }, { description: { contains: query.q } }] });
    const topicWhere = buildTopicIdsWhere(query.topicIds);
    if (topicWhere) andConditions.push(topicWhere as Prisma.KeywordWhereInput);
    if (andConditions.length > 0) where.AND = andConditions;
    const orderBy = { [query.sort]: query.order } as Prisma.KeywordOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.keyword.findMany({
        where,
        include: { _count: { select: { nodeLinks: true } } },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.keyword.count({ where }),
    ]);
    return toPaginated(rows.map(toKeywordListItem), total, query.page, query.pageSize);
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.keyword.findFirst({ where: { id, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async findOne(chatbotId: string, id: string): Promise<KeywordDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, id);
    const links = await this.prisma.dialogNodeKeyword.findMany({
      where: { keywordId: id },
      include: { node: { select: { id: true, name: true } } },
    });
    return toKeywordDetail(row, links.map((l) => l.node));
  }

  async update(chatbotId: string, id: string, dto: UpdateKeywordDto): Promise<KeywordDetail> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    let name = current.name;
    let nameNormalized = current.nameNormalized;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      nameNormalized = normalizeText(name);
      await this.assertNameFree(chatbotId, nameNormalized, id);
    }

    let synonyms = this.parseSynonymsJson(current.synonyms);
    if (dto.synonyms !== undefined) {
      const deduped = dedupeSynonyms(dto.synonyms);
      synonyms = deduped.synonyms;
      if (synonyms.length > MAX_SYNONYMS) {
        throw new ApiException('LIMIT_EXCEEDED', 400, `동의어는 최대 ${MAX_SYNONYMS}개까지 등록할 수 있습니다(현재 ${synonyms.length}개).`);
      }
    }
    if (dto.name !== undefined || dto.synonyms !== undefined) {
      await this.assertSynonymFree(chatbotId, name, synonyms, id);
    }
    if (dto.topicId !== undefined && dto.topicId !== null) {
      await this.topicLookup.assertTopicInChatbot(chatbotId, dto.topicId);
    }
    const onlyTopicIdChanged = dto.topicId !== undefined && dto.name === undefined && dto.description === undefined && dto.synonyms === undefined;

    const row = await this.prisma.keyword.update({
      where: { id },
      data: {
        name,
        nameNormalized,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.synonyms !== undefined ? { synonyms: JSON.stringify(synonyms) } : {}),
        ...(dto.topicId !== undefined ? { topicId: dto.topicId } : {}),
        ...(onlyTopicIdChanged ? { updatedAt: current.updatedAt } : {}),
      },
    });
    const links = await this.prisma.dialogNodeKeyword.findMany({
      where: { keywordId: id },
      include: { node: { select: { id: true, name: true } } },
    });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'Keyword',
      targetId: row.id,
      targetName: row.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
      after: this.toAuditSnapshot(row),
    });
    return toKeywordDetail(row, links.map((l) => l.node));
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.referenceCheck.assertKeywordDeletable(chatbotId, id);
    await this.prisma.keyword.delete({ where: { id } });
    this.bundleService.invalidate(chatbotId);
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'Keyword',
      targetId: current.id,
      targetName: current.name,
      chatbotId,
      before: this.toAuditSnapshot(current),
    });
  }

  async bulkDelete(chatbotId: string, dto: BulkDeleteDto): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const rows = await this.prisma.keyword.findMany({ where: { chatbotId, id: { in: dto.ids } } });
    if (rows.length !== dto.ids.length) throw new ApiException('NOT_FOUND', 404, '일부 키워드를 찾을 수 없습니다.');

    const blocked: Array<{ id: string; name: string }> = [];
    for (const row of rows) {
      try {
        await this.referenceCheck.assertKeywordDeletable(chatbotId, row.id);
      } catch (e) {
        if (e instanceof ApiException) blocked.push({ id: row.id, name: row.name });
        else throw e;
      }
    }
    if (blocked.length > 0) {
      throw new ApiException(
        'KEYWORD_IN_USE',
        409,
        `${blocked.length}건의 키워드가 다른 곳에서 사용 중이라 삭제할 수 없습니다. 전체 삭제가 취소되었습니다.`,
        blocked.map((b) => ({ field: b.id, message: b.name })),
      );
    }

    // [신규 No.25] 일괄 삭제 직전 자동 스냅샷(§6.4 훅 #4) — fail-open, 본 동작 트랜잭션 밖·직전.
    await this.versionCapture.captureAuto(chatbotId, 'BEFORE_BULK_DELETE', { resourceType: 'KEYWORD', itemCount: rows.length });

    await this.prisma.keyword.deleteMany({ where: { chatbotId, id: { in: dto.ids } } });
    this.bundleService.invalidate(chatbotId);

    const targetIds = dto.ids.slice(0, AUDIT_LIMITS.bulkTargetIds);
    await this.auditLogService.record({
      action: 'BULK_DELETE',
      targetType: 'Keyword',
      targetId: rows[0]?.id ?? '-',
      chatbotId,
      after: { deleted: rows.length, targetIds, truncated: dto.ids.length > targetIds.length },
      summary: `일괄 삭제 / 키워드 / ${rows.length}건`,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // 대량 업로드
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
        { canonical: '키워드명', aliases: ['keywordname', 'keyword_name'] },
        { canonical: '동의어', aliases: ['synonym'] },
      ])
    ) {
      throw new ApiException('IMPORT_FILE_INVALID', 400, '헤더 형식이 템플릿과 다릅니다. 템플릿을 내려받아 다시 시도해 주세요.');
    }
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) throw new ApiException('IMPORT_FILE_INVALID', 400, '데이터 행이 없습니다.');
    if (hasEncodingAnomaly(dataRows)) throw new ApiException('IMPORT_FILE_INVALID', 400, 'UTF-8로 저장 후 다시 업로드해 주세요.');

    const { parsed, errors } = parseNameValueRows(dataRows, { nameMax: 100, valueMax: 100 });

    const existingRows = await this.prisma.keyword.findMany({
      where: { chatbotId },
      select: { id: true, name: true, nameNormalized: true, synonyms: true },
    });
    const existing: ExistingNameValueRecord[] = existingRows.map((r) => ({
      id: r.id,
      name: r.name,
      nameNormalized: r.nameNormalized,
      values: this.parseSynonymsJson(r.synonyms),
    }));

    const plan = planNameValueImport(parsed, existing);
    const conflicts = findSynonymConflicts(plan.items, existing);
    const conflictRowErrors = conflictsToRowErrors(conflicts, parsed, plan.items);
    const allErrors = [...errors, ...conflictRowErrors];

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_LIMITS.tokenTtlMs);
    this.stagingStore.set(token, {
      chatbotId,
      resourceType: 'KEYWORD',
      plan: { plan, errors: allErrors } satisfies StagedKeywordPayload,
      expiresAt,
    });

    return {
      importToken: token,
      expiresAt,
      resourceType: 'KEYWORD',
      totalRows: plan.totalRows,
      newItems: plan.newItems,
      updatedItems: plan.updatedItems,
      newValues: plan.newValues,
      duplicatedRows: plan.duplicatedRows,
      errors: allErrors,
      conflicts,
    };
  }

  async importCommit(chatbotId: string, dto: ImportCommitRequestDto): Promise<ImportCommitResult> {
    await this.scope.assertWritable(chatbotId);
    const staged = this.stagingStore.take(dto.importToken);
    if (!staged || staged.chatbotId !== chatbotId || staged.resourceType !== 'KEYWORD') {
      throw new ApiException('IMPORT_TOKEN_EXPIRED', 400, '검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요.');
    }
    if (dto.newItemTopicId) await this.topicLookup.assertTopicInChatbot(chatbotId, dto.newItemTopicId);
    const { plan, errors } = staged.plan as StagedKeywordPayload;
    // 동의어 충돌 항목(SYNONYM_CONFLICT)이 하나라도 있는 키워드 묶음은 통째로 건너뛴다(FR-6-16 — 모호성 비허용).
    const conflictTerms = new Set(errors.filter((e) => e.code === 'SYNONYM_CONFLICT').map((e) => normalizeText(e.value)));

    if (dto.errorPolicy === 'ABORT_ON_ERROR' && errors.length > 0) {
      throw new ApiException('IMPORT_ABORTED', 400, `오류 ${errors.length}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다.`);
    }

    // [신규 No.25] 임포트 커밋 직전 자동 스냅샷(§6.4 훅 #3) — fail-open, 본 동작 트랜잭션 밖·직전.
    const autoSnapshot = await this.versionCapture.captureAuto(chatbotId, 'BEFORE_IMPORT', { resourceType: 'KEYWORD', itemCount: plan.items.length });

    let createdItems = 0;
    let updatedItems = 0;
    let createdValues = 0;
    const targetIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of plan.items) {
        const itemTerms = [item.nameNormalized, ...item.values.map(normalizeText)];
        if (itemTerms.some((t) => conflictTerms.has(t))) {
          // 이 묶음의 행은 모두 `importValidate`가 이미 SYNONYM_CONFLICT 오류(그룹 전체 스킵)로
          // 보고했으므로(`conflictsToRowErrors`), 별도 카운터 없이 skippedRows = duplicatedRows + errors.length로 정확히 집계된다.
          continue;
        }
        if (item.existingId) {
          if (dto.mergePolicy === 'SKIP') continue;
          const current = await tx.keyword.findUnique({ where: { id: item.existingId } });
          if (!current) continue;
          const currentSynonyms = this.parseSynonymsJson(current.synonyms);
          const nextSynonyms =
            dto.mergePolicy === 'REPLACE' ? item.values : dedupeSynonyms([...currentSynonyms, ...item.values]).synonyms;
          const capped = nextSynonyms.slice(0, MAX_SYNONYMS);
          await tx.keyword.update({
            where: { id: item.existingId },
            data: { synonyms: JSON.stringify(capped), ...(item.description ? { description: item.description } : {}) },
          });
          updatedItems += 1;
          createdValues += item.values.length;
          targetIds.push(item.existingId);
        } else {
          const capped = item.values.slice(0, MAX_SYNONYMS);
          const created = await tx.keyword.create({
            data: {
              chatbotId,
              name: item.name,
              nameNormalized: item.nameNormalized,
              description: item.description,
              synonyms: JSON.stringify(capped),
              topicId: dto.newItemTopicId ?? undefined,
            },
          });
          createdItems += 1;
          createdValues += capped.length;
          targetIds.push(created.id);
        }
      }
    });
    this.bundleService.invalidate(chatbotId);

    const cappedTargetIds = targetIds.slice(0, AUDIT_LIMITS.bulkTargetIds);
    await this.auditLogService.record({
      action: 'IMPORT',
      targetType: 'Keyword',
      targetId: cappedTargetIds[0] ?? '-',
      chatbotId,
      after: { created: createdItems, updated: updatedItems, targetIds: cappedTargetIds, truncated: targetIds.length > cappedTargetIds.length },
      summary: `대량 등록 / 키워드 / 신규 ${createdItems}건·갱신 ${updatedItems}건`,
    });

    return {
      createdItems,
      updatedItems,
      createdValues,
      skippedRows: plan.duplicatedRows + errors.length,
      errors,
      autoSnapshot,
    };
  }

  async importTemplate(format: 'csv' | 'xlsx'): Promise<{ content: Buffer | string; filename: string; mimeType: string }> {
    if (format === 'xlsx') {
      const content = await buildXlsxTemplate(KEYWORD_TEMPLATE_HEADERS);
      return {
        content,
        filename: 'keyword-template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return { content: buildCsv(KEYWORD_TEMPLATE_HEADERS, []), filename: 'keyword-template.csv', mimeType: 'text/csv; charset=utf-8' };
  }

  async export(chatbotId: string, topicIds?: string[]): Promise<{ content: string; filename: string; mimeType: string }> {
    await this.scope.assertReadable(chatbotId);
    const topicWhere = buildTopicIdsWhere(topicIds);
    const rows = await this.prisma.keyword.findMany({ where: { chatbotId, ...(topicWhere ?? {}) } });
    const lines: string[][] = [];
    for (const row of rows) {
      const synonyms = this.parseSynonymsJson(row.synonyms);
      if (synonyms.length === 0) {
        lines.push([row.name, '', row.description ?? '']);
        continue;
      }
      for (const synonym of synonyms) lines.push([row.name, synonym, row.description ?? '']);
    }
    return { content: buildCsv(KEYWORD_TEMPLATE_HEADERS, lines), filename: 'keywords-export.csv', mimeType: 'text/csv; charset=utf-8' };
  }
}
