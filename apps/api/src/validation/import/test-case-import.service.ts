import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { normalizeText, VALIDATION_LIMITS, IMPORT_LIMITS } from '@chat-bot/shared-types';
import type { ImportCommitRequestDto, ImportCommitResult, ImportRowError, ImportValidateResult, TestCaseExpectedKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import type { ImportStagingStore } from '../../dialogue-common/import/import-staging.store';
import { CsvSheetReader } from '../../dialogue-common/import/csv-sheet-reader';
import { XlsxSheetReader } from '../../dialogue-common/import/xlsx-sheet-reader';
import { ImportFileTooLargeError } from '../../dialogue-common/import/sheet-reader';
import type { SheetReader } from '../../dialogue-common/import/sheet-reader';
import { hasEncodingAnomaly } from '../../dialogue-common/import/lib/sheet-detect';
import { TestSetService } from '../test-set.service';
import { parseTestCaseRows } from '../lib/parse-test-case-row';
import type { ParsedTestCaseRow } from '../lib/parse-test-case-row';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface ResolvedImportItem {
  messages: string[];
  messagesNormalized: string;
  expectedKind: TestCaseExpectedKind;
  expectedTargetId?: string;
  expectedAnswerNote?: string;
}

interface StagedTestCasePayload {
  setId: string;
  items: ResolvedImportItem[];
  errors: ImportRowError[];
  duplicatedRows: number;
}

/**
 * TC 대량 업로드 — `SheetReader`/`ImportStagingStore`/`escapeCsvCell` **100% 재사용**(ADR-0007
 * 3번째 소비자, FR-V1-9~14). 이름→ID 해석은 dry-run 단계에서 수행하고, 실패는 `TARGET_NOT_FOUND`/
 * `AMBIGUOUS_TARGET`으로 보고한다. **새 파서를 만들지 않는다.**
 */
@Injectable()
export class TestCaseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly setService: TestSetService,
    private readonly auditLogService: AuditLogService,
    @Inject('ImportStagingStore') private readonly stagingStore: ImportStagingStore,
    private readonly csvReader: CsvSheetReader,
    private readonly xlsxReader: XlsxSheetReader,
  ) {}

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

  /** 기대대상명 → ID 해석(FR-V1-13). 정규화 기준 유일성이 DB 제약이라 실제로는 0~1건만 매칭되지만,
   * 향후 제약 완화에 대비해 방어적으로 다건(AMBIGUOUS_TARGET)도 판정한다. */
  private async resolveTargets(
    chatbotId: string,
    parsed: readonly ParsedTestCaseRow[],
  ): Promise<{ items: ResolvedImportItem[]; errors: ImportRowError[] }> {
    const kinds = ['INTENT', 'FAQ', 'NODE'] as const;
    const namesByKind: Record<(typeof kinds)[number], Map<string, string[]>> = { INTENT: new Map(), FAQ: new Map(), NODE: new Map() };

    const [intents, faqs, nodes] = await Promise.all([
      this.prisma.intent.findMany({ where: { chatbotId }, select: { id: true, nameNormalized: true } }),
      this.prisma.faqEntry.findMany({ where: { chatbotId }, select: { id: true, questionNormalized: true } }),
      this.prisma.dialogNode.findMany({ where: { chatbotId }, select: { id: true, nameNormalized: true } }),
    ]);
    for (const i of intents) namesByKind.INTENT.set(i.nameNormalized, [...(namesByKind.INTENT.get(i.nameNormalized) ?? []), i.id]);
    for (const f of faqs) namesByKind.FAQ.set(f.questionNormalized, [...(namesByKind.FAQ.get(f.questionNormalized) ?? []), f.id]);
    for (const n of nodes) namesByKind.NODE.set(n.nameNormalized, [...(namesByKind.NODE.get(n.nameNormalized) ?? []), n.id]);

    const errors: ImportRowError[] = [];
    const items: ResolvedImportItem[] = [];

    for (const row of parsed) {
      if (row.expectedKind === 'FALLBACK' || row.expectedKind === 'ANY') {
        items.push({ messages: row.messages, messagesNormalized: row.messagesNormalized, expectedKind: row.expectedKind, expectedAnswerNote: row.expectedAnswerNote });
        continue;
      }
      const kind = row.expectedKind as 'INTENT' | 'FAQ' | 'NODE';
      const targetName = row.expectedTargetName ?? '';
      const matches = namesByKind[kind].get(normalizeText(targetName)) ?? [];
      if (matches.length === 0) {
        errors.push({
          row: row.row,
          column: 'expectedTargetName',
          value: targetName,
          code: 'TARGET_NOT_FOUND',
          message: `기대 대상명 '${targetName}'을(를) 찾을 수 없습니다.`,
        });
        continue;
      }
      if (matches.length > 1) {
        errors.push({
          row: row.row,
          column: 'expectedTargetName',
          value: targetName,
          code: 'AMBIGUOUS_TARGET',
          message: `기대 대상명 '${targetName}'과(와) 일치하는 대상이 여러 건입니다.`,
        });
        continue;
      }
      items.push({
        messages: row.messages,
        messagesNormalized: row.messagesNormalized,
        expectedKind: row.expectedKind,
        expectedTargetId: matches[0],
        expectedAnswerNote: row.expectedAnswerNote,
      });
    }

    return { items, errors };
  }

  async validate(chatbotId: string, setId: string, file: UploadedFile): Promise<ImportValidateResult> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);
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
    if (hasEncodingAnomaly(rows)) throw new ApiException('IMPORT_FILE_INVALID', 400, 'UTF-8로 저장 후 다시 업로드해 주세요.');

    const { parsed, errors: parseErrors } = parseTestCaseRows(rows);
    const { items: resolvedItems, errors: targetErrors } = await this.resolveTargets(chatbotId, parsed);
    const errors = [...parseErrors, ...targetErrors];

    const existing = await this.prisma.testCase.findMany({ where: { setId }, select: { messagesNormalized: true } });
    const existingKeys = new Set(existing.map((e) => e.messagesNormalized));
    const seenInFile = new Set<string>();
    let duplicatedRows = 0;
    const items: ResolvedImportItem[] = [];
    for (const item of resolvedItems) {
      if (existingKeys.has(item.messagesNormalized) || seenInFile.has(item.messagesNormalized)) {
        duplicatedRows += 1;
        continue;
      }
      seenInFile.add(item.messagesNormalized);
      items.push(item);
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_LIMITS.tokenTtlMs);
    const payload: StagedTestCasePayload = { setId, items, errors, duplicatedRows };
    this.stagingStore.set(token, { chatbotId, resourceType: 'TEST_CASE', plan: payload, expiresAt });

    return {
      importToken: token,
      expiresAt,
      resourceType: 'TEST_CASE',
      totalRows: rows.length,
      newItems: items.length,
      updatedItems: 0,
      newValues: items.length,
      duplicatedRows,
      errors,
      conflicts: [],
    };
  }

  async commit(chatbotId: string, setId: string, dto: ImportCommitRequestDto): Promise<ImportCommitResult> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const staged = this.stagingStore.take(dto.importToken);
    if (!staged || staged.chatbotId !== chatbotId || staged.resourceType !== 'TEST_CASE') {
      throw new ApiException('IMPORT_TOKEN_EXPIRED', 400, '검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요.');
    }
    const { setId: stagedSetId, items, errors, duplicatedRows } = staged.plan as StagedTestCasePayload;
    if (stagedSetId !== setId) {
      throw new ApiException('IMPORT_TOKEN_EXPIRED', 400, '검증 결과가 다른 세트에서 생성되었습니다. 다시 검증해 주세요.');
    }
    if (dto.errorPolicy === 'ABORT_ON_ERROR' && errors.length > 0) {
      throw new ApiException('IMPORT_ABORTED', 400, `오류 ${errors.length}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다.`);
    }

    const [setCount, chatbotCount] = await Promise.all([
      this.prisma.testCase.count({ where: { setId } }),
      this.prisma.testCase.count({ where: { chatbotId } }),
    ]);
    if (setCount + items.length > VALIDATION_LIMITS.maxCasesPerSet || chatbotCount + items.length > VALIDATION_LIMITS.maxCasesPerChatbot) {
      throw new ApiException('TEST_CASE_LIMIT_EXCEEDED', 409, 'TC 상한을 초과합니다(세트당 2,000건 · 챗봇당 5,000건).');
    }

    let createdItems = 0;
    await this.prisma.$transaction(async (tx) => {
      const maxSeq = await tx.testCase.aggregate({ where: { setId }, _max: { seq: true } });
      const startSeq = maxSeq._max.seq ?? 0;
      if (items.length === 0) return;
      // 최대 2,000건을 순차 create() 대신 createMany() 일괄 처리로 커밋 20초 예산의 여유를 확보한다
      // (code-review 대응, 정확성 문제는 아니었음 — 트랜잭션·tx 프리픽스는 기존 그대로 유지).
      const result = await tx.testCase.createMany({
        data: items.map((item, i) => ({
          setId,
          chatbotId,
          seq: startSeq + i + 1,
          messages: JSON.stringify(item.messages),
          messagesNormalized: item.messagesNormalized,
          expectedKind: item.expectedKind,
          expectedTargetId: item.expectedTargetId,
          expectedAnswerNote: item.expectedAnswerNote,
        })),
      });
      createdItems = result.count;
    });

    const set = await this.prisma.testCaseSet.findUnique({ where: { id: setId } });
    const caseCount = await this.prisma.testCase.count({ where: { setId } });
    await this.auditLogService.record({
      action: 'IMPORT',
      targetType: 'TestCaseSet',
      targetId: setId,
      targetName: set?.name ?? '-',
      chatbotId,
      after: { name: set?.name, description: set?.description, isDefault: set?.isDefault, caseCount, imported: createdItems },
      summary: `대량 등록 / 검증 세트 / TC ${createdItems}건`,
    });

    return { createdItems, updatedItems: 0, createdValues: createdItems, skippedRows: duplicatedRows + errors.length, errors };
  }
}
