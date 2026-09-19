// 마이그레이션 ②단계 — `*Normalized` 컬럼 백필 + intentIds/keywordIds JSON → 조인 테이블 이관.
// `docs/02-spec/dialogue-design-설계.md` §3.2, ADR-0005/0006 근거.
// 멱등: 여러 번 실행해도 안전하다(같은 값으로 덮어쓰기, 조인 행은 upsert 대체 delete+create).
// 정규화 충돌(같은 챗봇 내 동일 정규화 값 중복)이 발견되면 중단하고 충돌 목록을 출력한다.
import { PrismaClient } from '@prisma/client';
import { normalizeText } from '@chat-bot/shared-types';

const prisma = new PrismaClient();

interface ConflictReport {
  model: string;
  chatbotId: string;
  normalized: string;
  ids: string[];
}

async function backfillModel(params: {
  model: 'intent' | 'keyword' | 'contextVariable' | 'dialogNode' | 'homonymDictionary' | 'faqEntry';
  sourceField: 'name' | 'word' | 'question';
  normalizedField: string;
}): Promise<ConflictReport[]> {
  const { model, sourceField, normalizedField } = params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[model];
  const rows: Array<{ id: string; chatbotId: string; [key: string]: unknown }> = await delegate.findMany({
    select: { id: true, chatbotId: true, [sourceField]: true },
  });

  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const normalized = normalizeText(String(row[sourceField]));
    const key = `${row.chatbotId}::${normalized}`;
    const list = byKey.get(key);
    if (list) list.push(row.id);
    else byKey.set(key, [row.id]);
  }

  const conflicts: ConflictReport[] = [];
  for (const [key, ids] of byKey.entries()) {
    if (ids.length > 1) {
      const [chatbotId, normalized] = key.split('::');
      conflicts.push({ model, chatbotId, normalized, ids });
    }
  }
  if (conflicts.length > 0) return conflicts;

  await Promise.all(
    rows.map((row) =>
      delegate.update({
        where: { id: row.id },
        data: { [normalizedField]: normalizeText(String(row[sourceField])) },
      }),
    ),
  );

  // eslint-disable-next-line no-console
  console.log(`  - ${model}.${normalizedField} 백필 완료 (${rows.length}건)`);
  return [];
}

/** DialogNode.intentIds/keywordIds JSON → DialogNodeIntent/DialogNodeKeyword 조인 행 이관. */
async function migrateNodeLinks(): Promise<void> {
  const nodes = await prisma.dialogNode.findMany({ select: { id: true, intentIds: true, keywordIds: true } });
  let intentLinkCount = 0;
  let keywordLinkCount = 0;

  for (const node of nodes) {
    let intentIds: string[] = [];
    let keywordIds: string[] = [];
    try {
      intentIds = JSON.parse(node.intentIds || '[]');
    } catch {
      intentIds = [];
    }
    try {
      keywordIds = JSON.parse(node.keywordIds || '[]');
    } catch {
      keywordIds = [];
    }

    await prisma.dialogNodeIntent.deleteMany({ where: { nodeId: node.id } });
    await prisma.dialogNodeKeyword.deleteMany({ where: { nodeId: node.id } });

    const uniqueIntentIds = [...new Set(intentIds)];
    const uniqueKeywordIds = [...new Set(keywordIds)];

    if (uniqueIntentIds.length > 0) {
      const existing = await prisma.intent.findMany({ where: { id: { in: uniqueIntentIds } }, select: { id: true } });
      const validIds = new Set(existing.map((e) => e.id));
      const toCreate = uniqueIntentIds.filter((id) => validIds.has(id));
      if (toCreate.length > 0) {
        await prisma.dialogNodeIntent.createMany({ data: toCreate.map((intentId) => ({ nodeId: node.id, intentId })) });
        intentLinkCount += toCreate.length;
      }
    }
    if (uniqueKeywordIds.length > 0) {
      const existing = await prisma.keyword.findMany({ where: { id: { in: uniqueKeywordIds } }, select: { id: true } });
      const validIds = new Set(existing.map((e) => e.id));
      const toCreate = uniqueKeywordIds.filter((id) => validIds.has(id));
      if (toCreate.length > 0) {
        await prisma.dialogNodeKeyword.createMany({ data: toCreate.map((keywordId) => ({ nodeId: node.id, keywordId })) });
        keywordLinkCount += toCreate.length;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`  - dialog_node_intents ${intentLinkCount}건, dialog_node_keywords ${keywordLinkCount}건 이관 완료`);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('대화 설계 정규화 백필 시작...');

  const allConflicts: ConflictReport[] = [];
  allConflicts.push(...(await backfillModel({ model: 'intent', sourceField: 'name', normalizedField: 'nameNormalized' })));
  allConflicts.push(...(await backfillModel({ model: 'keyword', sourceField: 'name', normalizedField: 'nameNormalized' })));
  allConflicts.push(
    ...(await backfillModel({ model: 'contextVariable', sourceField: 'name', normalizedField: 'nameNormalized' })),
  );
  allConflicts.push(...(await backfillModel({ model: 'dialogNode', sourceField: 'name', normalizedField: 'nameNormalized' })));
  allConflicts.push(
    ...(await backfillModel({ model: 'homonymDictionary', sourceField: 'word', normalizedField: 'wordNormalized' })),
  );
  allConflicts.push(
    ...(await backfillModel({ model: 'faqEntry', sourceField: 'question', normalizedField: 'questionNormalized' })),
  );

  if (allConflicts.length > 0) {
    // eslint-disable-next-line no-console
    console.error('정규화 충돌이 발견되어 중단합니다. 아래 항목을 수동으로 정리한 뒤 다시 실행해 주세요:');
    for (const c of allConflicts) {
      // eslint-disable-next-line no-console
      console.error(`  - [${c.model}] chatbotId=${c.chatbotId} normalized="${c.normalized}" ids=${c.ids.join(', ')}`);
    }
    process.exit(1);
  }

  await migrateNodeLinks();

  // eslint-disable-next-line no-console
  console.log('백필 완료. 다음 단계: prisma migrate dev --name add_dialogue_normalized_unique');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
