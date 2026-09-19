import { Logger } from '@nestjs/common';
import type { DialogNode as PrismaDialogNode } from '@prisma/client';
import type { DialogMatchMode, DialogNode, DialogNodeType, DialogOutput } from '@chat-bot/shared-types';

const logger = new Logger('DialogNodeMapper');

export type NodeRowWithLinks = PrismaDialogNode & {
  intentLinks: Array<{ intentId: string }>;
  keywordLinks: Array<{ keywordId: string }>;
};

export function parseOutputs(json: string, nodeId: string): DialogOutput[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as DialogOutput[]) : [];
  } catch {
    logger.warn(`outputs 파싱 실패(nodeId=${nodeId}) — 기본값([])으로 폴백`);
    return [];
  }
}

/** Prisma row(조인 포함) → 엔티티. 조인 행 ↔ `intentIds`/`keywordIds` 배열 변환은 여기서만 수행한다(ADR-0005). */
export function toDialogNodeEntity(row: NodeRowWithLinks): DialogNode {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    description: row.description ?? undefined,
    nodeType: (row.nodeType as DialogNodeType) ?? 'NORMAL',
    matchMode: (row.matchMode as DialogMatchMode) ?? 'ANY',
    enabled: row.enabled,
    priority: row.priority,
    intentIds: row.intentLinks.map((l) => l.intentId),
    keywordIds: row.keywordLinks.map((l) => l.keywordId),
    contextVariableId: row.contextVariableId ?? undefined,
    outputs: parseOutputs(row.outputs, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
