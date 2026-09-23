import type { TestCaseSet as PrismaTestCaseSet } from '@prisma/client';
import type { TestCaseSet } from '@chat-bot/shared-types';

export function toTestCaseSetDto(row: PrismaTestCaseSet, caseCount: number): TestCaseSet {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? null,
    isDefault: row.isDefault,
    caseCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
