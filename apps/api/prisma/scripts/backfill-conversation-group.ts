// No.29 통합 통계 — `ConversationLog.groupId` 1회성 백필(FR-I2-3, ADR-0033 §4).
// `backfill-conversation-buckets.ts` 형식을 따른다. 원시 SQL 0건(Prisma `findMany` + `updateMany`).
// 챗봇별로 "현재 groupId"를 그 챗봇의 groupId=''(백필 미완 센티넬) 로그에 채운다 — 보관 챗봇 포함.
// 멱등·재개 가능: 조건이 `groupId=''`뿐이라 몇 번을 실행해도 결과가 같다(AC-I3-4).
// 감사로그 기반 소급 재귀속은 하지 않는다 — 백필 이전 그룹 이동 이력은 복원되지 않는다(EX-I-6, §17 L-1).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 2000;

async function backfillChatbot(chatbotId: string, groupId: string): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = await prisma.conversationLog.findMany({
      where: { chatbotId, groupId: '' },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (ids.length === 0) break;

    await prisma.conversationLog.updateMany({
      where: { id: { in: ids.map((r) => r.id) }, groupId: '' },
      data: { groupId },
    });
    total += ids.length;
    // eslint-disable-next-line no-console
    console.log(`  - chatbotId=${chatbotId} ${total}건 처리 완료`);
  }
  return total;
}

async function verify(): Promise<number> {
  return prisma.conversationLog.count({ where: { groupId: '' } });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('ConversationLog.groupId 백필 시작...');

  const chatbots = await prisma.chatbot.findMany({ select: { id: true, groupId: true } }); // 보관 챗봇 포함
  let totalProcessed = 0;
  for (const chatbot of chatbots) {
    totalProcessed += await backfillChatbot(chatbot.id, chatbot.groupId);
  }

  const remaining = await verify();
  if (remaining > 0) {
    // eslint-disable-next-line no-console
    console.error(`검증 실패: groupId='' 인 행이 ${remaining}건 남아 있습니다.`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`백필 완료. 총 ${totalProcessed}건 처리, 검증 쿼리 0건 확인.`);
  // eslint-disable-next-line no-console
  console.log('과거 그룹 이동 이력은 복원하지 않았습니다 — 백필 이전 로그는 모두 현재 소속 그룹에 귀속됩니다(EX-I-6).');
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
