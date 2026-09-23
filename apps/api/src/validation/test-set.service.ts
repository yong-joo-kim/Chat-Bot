import { Injectable } from '@nestjs/common';
import { normalizeText, VALIDATION_LIMITS } from '@chat-bot/shared-types';
import type { CreateTestCaseSetDto, Paginated, TestCaseSet, TestCaseSetListQuery, UpdateTestCaseSetDto } from '@chat-bot/shared-types';
import type { TestCaseSet as PrismaTestCaseSet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { buildXlsxTemplate } from '../dialogue-common/import/lib/xlsx-writer';
import { buildTestCaseTemplateCsv, TEST_CASE_TEMPLATE_HEADERS } from './lib/test-case-csv';
import { toTestCaseSetDto } from './test-set.mapper';

const NOT_FOUND_MESSAGE = '요청하신 검증 세트를 찾을 수 없습니다.';

/**
 * TC 세트 CRUD + 감사 기록 지점(FR-V1-1, FR-V1-8). **이 그룹에서 유일한 감사 대상**이다 —
 * 실행·비교는 읽기 연산이라 감사하지 않는다(ADR-0029 §5).
 */
@Injectable()
export class TestSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** 다른 검증 서비스(TC/실행)가 재사용하는 소유권 검증 진입점. */
  async getRowOrThrow(chatbotId: string, setId: string): Promise<PrismaTestCaseSet> {
    const row = await this.prisma.testCaseSet.findFirst({ where: { id: setId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async list(chatbotId: string, query: TestCaseSetListQuery): Promise<Paginated<TestCaseSet>> {
    await this.scope.assertReadable(chatbotId);
    const where = {
      chatbotId,
      ...(query.q ? { nameNormalized: { contains: normalizeText(query.q) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.testCaseSet.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.testCaseSet.count({ where }),
    ]);
    const counts = await this.prisma.testCase.groupBy({ by: ['setId'], where: { setId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const countBySet = new Map(counts.map((c) => [c.setId, c._count._all] as const));
    return toPaginated(
      rows.map((r) => toTestCaseSetDto(r, countBySet.get(r.id) ?? 0)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(chatbotId: string, dto: CreateTestCaseSetDto): Promise<TestCaseSet> {
    await this.scope.assertWritable(chatbotId);
    const count = await this.prisma.testCaseSet.count({ where: { chatbotId } });
    if (count >= VALIDATION_LIMITS.maxSetsPerChatbot) {
      throw new ApiException('LIMIT_EXCEEDED', 409, `검증 세트는 챗봇당 최대 ${VALIDATION_LIMITS.maxSetsPerChatbot}개까지 만들 수 있습니다.`);
    }
    const nameNormalized = normalizeText(dto.name);
    const dup = await this.prisma.testCaseSet.findFirst({ where: { chatbotId, nameNormalized } });
    if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 검증 세트가 있습니다.');

    const created = await this.prisma.testCaseSet.create({
      data: { chatbotId, name: dto.name, nameNormalized, description: dto.description, isDefault: dto.isDefault ?? false },
    });
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'TestCaseSet',
      targetId: created.id,
      targetName: created.name,
      chatbotId,
      after: { name: created.name, description: created.description, isDefault: created.isDefault, caseCount: 0 },
      summary: `검증 세트 생성 / ${created.name}`,
    });
    return toTestCaseSetDto(created, 0);
  }

  async update(chatbotId: string, setId: string, dto: UpdateTestCaseSetDto): Promise<TestCaseSet> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.getRowOrThrow(chatbotId, setId);

    let nameNormalized: string | undefined;
    if (dto.name !== undefined) {
      nameNormalized = normalizeText(dto.name);
      const dup = await this.prisma.testCaseSet.findFirst({ where: { chatbotId, nameNormalized, id: { not: setId } } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 이름의 검증 세트가 있습니다.');
    }

    const updated = await this.prisma.testCaseSet.update({
      where: { id: setId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name, nameNormalized } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });
    const caseCount = await this.prisma.testCase.count({ where: { setId } });
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'TestCaseSet',
      targetId: setId,
      targetName: updated.name,
      chatbotId,
      before: { name: current.name, description: current.description, isDefault: current.isDefault, caseCount },
      after: { name: updated.name, description: updated.description, isDefault: updated.isDefault, caseCount },
      summary: `검증 세트 수정 / ${updated.name}`,
    });
    return toTestCaseSetDto(updated, caseCount);
  }

  async remove(chatbotId: string, setId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.getRowOrThrow(chatbotId, setId);
    const caseCount = await this.prisma.testCase.count({ where: { setId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.testRunResult.deleteMany({ where: { run: { setId } } });
      await tx.testRun.deleteMany({ where: { setId } });
      await tx.testCase.deleteMany({ where: { setId } });
      await tx.testCaseSet.delete({ where: { id: setId } });
    });

    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'TestCaseSet',
      targetId: setId,
      targetName: current.name,
      chatbotId,
      before: { name: current.name, description: current.description, isDefault: current.isDefault, caseCount },
      summary: `검증 세트 삭제 / ${current.name}(TC ${caseCount}건 포함)`,
    });
  }

  async template(format: 'csv' | 'xlsx'): Promise<{ content: Buffer | string; filename: string; mimeType: string }> {
    if (format === 'xlsx') {
      const content = await buildXlsxTemplate(TEST_CASE_TEMPLATE_HEADERS);
      return { content, filename: 'test-case-template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    return { content: buildTestCaseTemplateCsv(), filename: 'test-case-template.csv', mimeType: 'text/csv; charset=utf-8' };
  }
}
