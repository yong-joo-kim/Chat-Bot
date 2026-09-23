import type { TestCase as PrismaTestCase } from '@prisma/client';
import type { TestCase, TestCaseExpectedKind } from '@chat-bot/shared-types';

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * `expectedTargetName`은 **조회 시점에** 현재 자산에서 해석해 채운다(FR-V1-4) — 저장하지 않는다.
 * `nameById`가 없거나 대상이 사라졌으면 `null`(화면이 "⚠ 대상 삭제됨"을 표시한다).
 */
export function toTestCaseDto(row: PrismaTestCase, nameById?: ReadonlyMap<string, string>): TestCase {
  const expectedTargetId = row.expectedTargetId ?? null;
  return {
    id: row.id,
    setId: row.setId,
    chatbotId: row.chatbotId,
    seq: row.seq,
    messages: parseJsonArray(row.messages),
    expectedKind: row.expectedKind as TestCaseExpectedKind,
    expectedTargetId,
    expectedTargetName: expectedTargetId ? (nameById?.get(expectedTargetId) ?? null) : null,
    expectedAnswerNote: row.expectedAnswerNote ?? null,
    tags: row.tags ? parseJsonArray(row.tags) : null,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
