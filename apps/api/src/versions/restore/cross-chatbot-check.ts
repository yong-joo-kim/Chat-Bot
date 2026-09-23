import type { Prisma } from '@prisma/client';
import type { VersionIntegrityWarning } from '@chat-bot/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * §5.5 ⑤ / FR-H3-11 — 스냅샷의 `id`가 **다른 챗봇의 행**으로 이미 존재하는지 검사한다(정상 경로로는
 * 불가능하지만 방어적으로 검사한다 — 존재하면 복원 시 다른 챗봇의 행을 원래 챗봇으로 재배정하려다
 * FK/유니크 제약과 충돌해 `500`이 나는 대신 `422 VERSION_INTEGRITY_FAILED`로 명확히 거부한다).
 * DB 의존이라 `lib/snapshot-integrity.ts`(순수 함수)가 아니라 여기 둔다. 인터랙티브 트랜잭션(tx)
 * 안에서 호출될 수 있으므로 **순차** 조회한다(§6.1 — tx 위 Promise.all 금지, M-1과 동일한 이유).
 */
export async function findCrossChatbotIdConflicts(db: Db, chatbotId: string, envelope: SnapshotEnvelope): Promise<VersionIntegrityWarning[]> {
  const violations: VersionIntegrityWarning[] = [];

  const intentIds = envelope.assets.intents.map((i) => i.id);
  if (intentIds.length > 0) {
    const rows = await db.intent.findMany({ where: { id: { in: intentIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'INTENT', id: row.id });
  }

  const keywordIds = envelope.assets.keywords.map((k) => k.id);
  if (keywordIds.length > 0) {
    const rows = await db.keyword.findMany({ where: { id: { in: keywordIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'KEYWORD', id: row.id });
  }

  const homonymIds = envelope.assets.homonyms.map((h) => h.id);
  if (homonymIds.length > 0) {
    const rows = await db.homonymDictionary.findMany({ where: { id: { in: homonymIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'HOMONYM', id: row.id });
  }

  const contextIds = envelope.assets.contexts.map((c) => c.id);
  if (contextIds.length > 0) {
    const rows = await db.contextVariable.findMany({ where: { id: { in: contextIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'CONTEXT', id: row.id });
  }

  const nodeIds = envelope.assets.dialogNodes.map((n) => n.id);
  if (nodeIds.length > 0) {
    const rows = await db.dialogNode.findMany({ where: { id: { in: nodeIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'NODE', id: row.id });
  }

  const faqIds = envelope.assets.faqs.map((f) => f.id);
  if (faqIds.length > 0) {
    const rows = await db.faqEntry.findMany({ where: { id: { in: faqIds }, chatbotId: { not: chatbotId } }, select: { id: true } });
    for (const row of rows) violations.push({ rule: 'CROSS_CHATBOT_ID', kind: 'FAQ', id: row.id });
  }

  return violations;
}
