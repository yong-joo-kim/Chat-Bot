import { Injectable } from '@nestjs/common';
import { normalizeText, VALIDATION_LIMITS } from '@chat-bot/shared-types';
import type {
  BulkDisableTestCasesDto,
  CreateTestCaseDto,
  Paginated,
  TestCase,
  TestCaseListQuery,
  UpdateTestCaseDto,
} from '@chat-bot/shared-types';
import type { TestCase as PrismaTestCase } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { TestSetService } from './test-set.service';
import { TargetNameResolverService } from './target-name-resolver.service';
import { toTestCaseDto } from './test-case.mapper';
import { buildTestCaseExportCsv } from './lib/test-case-csv';
import { messagesNormalizedKey } from './lib/parse-test-case-row';

const NOT_FOUND_MESSAGE = '요청하신 TC를 찾을 수 없습니다.';

/** TC CRUD(FR-V1-2~7). 개별 TC 편집은 소속 세트의 UPDATE로 감사에 기록한다(FR-V1-8). */
@Injectable()
export class TestCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly setService: TestSetService,
    private readonly nameResolver: TargetNameResolverService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async resolveNameMap(chatbotId: string, rows: readonly PrismaTestCase[]): Promise<Map<string, string>> {
    const refs = rows
      .filter((r) => r.expectedTargetId && r.expectedKind !== 'FALLBACK' && r.expectedKind !== 'ANY')
      .map((r) => ({ kind: r.expectedKind as 'INTENT' | 'FAQ' | 'NODE', id: r.expectedTargetId as string }));
    return this.nameResolver.resolveNames(chatbotId, refs);
  }

  private async recordSetAudit(chatbotId: string, setId: string, summary: string): Promise<void> {
    const set = await this.prisma.testCaseSet.findUnique({ where: { id: setId } });
    if (!set) return;
    const caseCount = await this.prisma.testCase.count({ where: { setId } });
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'TestCaseSet',
      targetId: setId,
      targetName: set.name,
      chatbotId,
      after: { name: set.name, description: set.description, isDefault: set.isDefault, caseCount },
      summary,
    });
  }

  async list(chatbotId: string, setId: string, query: TestCaseListQuery): Promise<Paginated<TestCase>> {
    await this.scope.assertReadable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const where = {
      setId,
      ...(query.expectedKind ? { expectedKind: query.expectedKind } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.q ? { messagesNormalized: { contains: normalizeText(query.q) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.testCase.findMany({ where, orderBy: { seq: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.testCase.count({ where }),
    ]);
    const nameById = await this.resolveNameMap(chatbotId, rows);
    return toPaginated(
      rows.map((r) => toTestCaseDto(r, nameById)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(chatbotId: string, setId: string, dto: CreateTestCaseDto): Promise<TestCase> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const [setCount, chatbotCount] = await Promise.all([
      this.prisma.testCase.count({ where: { setId } }),
      this.prisma.testCase.count({ where: { chatbotId } }),
    ]);
    if (setCount >= VALIDATION_LIMITS.maxCasesPerSet || chatbotCount >= VALIDATION_LIMITS.maxCasesPerChatbot) {
      throw new ApiException('TEST_CASE_LIMIT_EXCEEDED', 409, 'TC 상한을 초과했습니다(세트당 2,000건 · 챗봇당 5,000건).');
    }

    const messagesNormalized = messagesNormalizedKey(dto.messages);
    const dup = await this.prisma.testCase.findFirst({ where: { setId, messagesNormalized } });
    if (dup) throw new ApiException('DUPLICATE_NAME', 409, '같은 문장 조합의 TC가 이미 있습니다.');

    const maxSeq = await this.prisma.testCase.aggregate({ where: { setId }, _max: { seq: true } });
    const created = await this.prisma.testCase.create({
      data: {
        setId,
        chatbotId,
        seq: (maxSeq._max.seq ?? 0) + 1,
        messages: JSON.stringify(dto.messages),
        messagesNormalized,
        expectedKind: dto.expectedKind,
        expectedTargetId: dto.expectedTargetId,
        expectedAnswerNote: dto.expectedAnswerNote,
        tags: dto.tags ? JSON.stringify(dto.tags) : null,
        enabled: dto.enabled,
      },
    });
    await this.recordSetAudit(chatbotId, setId, 'TC 추가');
    const nameById = await this.resolveNameMap(chatbotId, [created]);
    return toTestCaseDto(created, nameById);
  }

  async update(chatbotId: string, setId: string, caseId: string, dto: UpdateTestCaseDto): Promise<TestCase> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);
    const current = await this.prisma.testCase.findFirst({ where: { id: caseId, setId } });
    if (!current) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    let messagesNormalized: string | undefined;
    if (dto.messages !== undefined) {
      messagesNormalized = messagesNormalizedKey(dto.messages);
      const dup = await this.prisma.testCase.findFirst({ where: { setId, messagesNormalized, id: { not: caseId } } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 409, '같은 문장 조합의 TC가 이미 있습니다.');
    }

    const updated = await this.prisma.testCase.update({
      where: { id: caseId },
      data: {
        ...(dto.messages !== undefined ? { messages: JSON.stringify(dto.messages), messagesNormalized } : {}),
        ...(dto.expectedKind !== undefined ? { expectedKind: dto.expectedKind } : {}),
        ...(dto.expectedTargetId !== undefined ? { expectedTargetId: dto.expectedTargetId } : {}),
        ...(dto.expectedAnswerNote !== undefined ? { expectedAnswerNote: dto.expectedAnswerNote } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags ? JSON.stringify(dto.tags) : null } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    await this.recordSetAudit(chatbotId, setId, 'TC 수정');
    const nameById = await this.resolveNameMap(chatbotId, [updated]);
    return toTestCaseDto(updated, nameById);
  }

  async remove(chatbotId: string, setId: string, caseId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);
    const current = await this.prisma.testCase.findFirst({ where: { id: caseId, setId } });
    if (!current) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    await this.prisma.testCase.delete({ where: { id: caseId } });
    await this.recordSetAudit(chatbotId, setId, 'TC 삭제');
  }

  /** `UNRESOLVED` TC 일괄 비활성(S-4). 존재하지 않는 id는 조용히 건너뛴다. */
  async bulkDisable(chatbotId: string, setId: string, dto: BulkDisableTestCasesDto): Promise<{ updated: number }> {
    await this.scope.assertWritable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const result = await this.prisma.testCase.updateMany({
      where: { id: { in: dto.caseIds }, setId },
      data: { enabled: false },
    });
    await this.recordSetAudit(chatbotId, setId, `TC 일괄 비활성 (${result.count}건)`);
    return { updated: result.count };
  }

  async export(chatbotId: string, setId: string): Promise<{ content: string; filename: string; mimeType: string }> {
    await this.scope.assertReadable(chatbotId);
    await this.setService.getRowOrThrow(chatbotId, setId);

    const rows = await this.prisma.testCase.findMany({ where: { setId }, orderBy: { seq: 'asc' } });
    const nameById = await this.resolveNameMap(chatbotId, rows);
    const exportRows = rows.map((r) => {
      const dto = toTestCaseDto(r, nameById);
      return { messages: dto.messages, expectedKind: dto.expectedKind, expectedTargetName: dto.expectedTargetName, expectedAnswerNote: dto.expectedAnswerNote };
    });
    return { content: buildTestCaseExportCsv(exportRows), filename: 'test-cases-export.csv', mimeType: 'text/csv; charset=utf-8' };
  }
}
