import type { AuditLog as PrismaAuditLog } from '@prisma/client';
import { AuditAction, AuditTargetType } from '@chat-bot/shared-types';
import type { AuditLogDetail, AuditLogListItem } from '@chat-bot/shared-types';
import { computeChangedFields } from './lib/audit-diff';
import { parseRowHashMethod } from './chain/audit-chain';

function parseAction(raw: string): AuditAction {
  const result = AuditAction.safeParse(raw);
  return result.success ? result.data : 'UPDATE';
}

function parseTargetType(raw: string): AuditTargetType {
  const result = AuditTargetType.safeParse(raw);
  return result.success ? result.data : 'Chatbot';
}

function parseSnapshotJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toAuditLogListItem(row: PrismaAuditLog): AuditLogListItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    action: parseAction(row.action),
    targetType: parseTargetType(row.targetType),
    targetId: row.targetId,
    targetName: row.targetName,
    chatbotId: row.chatbotId,
    summary: row.summary,
  };
}

export function toAuditLogDetail(row: PrismaAuditLog): AuditLogDetail {
  const before = parseSnapshotJson(row.beforeValue);
  const after = parseSnapshotJson(row.afterValue);
  const truncated = Boolean((before as { __truncated?: boolean } | null)?.__truncated) || Boolean((after as { __truncated?: boolean } | null)?.__truncated);

  // [신규 No.45] 체인 도입 후 행만(`seq`·`prevHash`·`rowHash` 전부 값이 있을 때) — 값이 없으면 키 생략.
  const chainMethod = row.rowHash ? parseRowHashMethod(row.rowHash) : null;
  const chain =
    row.seq !== null && row.prevHash !== null && row.rowHash !== null && chainMethod
      ? { seq: row.seq, prevHash: row.prevHash, rowHash: row.rowHash, method: chainMethod.method }
      : undefined;

  return {
    ...toAuditLogListItem(row),
    before,
    after,
    changedFields: computeChangedFields(before, after),
    truncated,
    ip: row.ip,
    userAgent: row.userAgent,
    chain,
  };
}
