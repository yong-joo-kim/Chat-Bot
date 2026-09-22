// 마이그레이션 ②단계 — `ConversationLog.dayBucket`/`hourBucket` 백필(DD-50/59/64, ADR-0017).
// `docs/02-spec/stats-learning-설계.md` §3.3 근거. `backfill-dialogue-normalized.ts` 선례를 따른다.
// 2,000행 배치로 순회하며 배치마다 커밋한다. `where: { dayBucket: '' }`로 재개 가능(멱등 — 같은
// 값을 덮어쓰므로 여러 번 실행해도 안전하다). 버킷 계산은 API와 동일한 `@chat-bot/shared-types`
// 순수 함수를 사용한다 — 스크립트가 자체 날짜 로직을 갖지 않는다(FR-0-31).
import { PrismaClient } from '@prisma/client';
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';

const prisma = new PrismaClient();
const BATCH_SIZE = 2000;

async function backfillBatch(): Promise<number> {
  const rows = await prisma.conversationLog.findMany({
    where: { dayBucket: '' },
    select: { id: true, createdAt: true },
    take: BATCH_SIZE,
  });
  if (rows.length === 0) return 0;

  await Promise.all(
    rows.map((row) =>
      prisma.conversationLog.update({
        where: { id: row.id },
        data: {
          dayBucket: toKstDayBucket(row.createdAt),
          hourBucket: toKstHourOfDay(row.createdAt),
        },
      }),
    ),
  );
  return rows.length;
}

async function verify(): Promise<number> {
  return prisma.conversationLog.count({
    where: { OR: [{ dayBucket: '' }, { hourBucket: { lt: 0 } }] },
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('ConversationLog dayBucket/hourBucket 백필 시작...');

  let totalProcessed = 0;
  for (;;) {
    const processed = await backfillBatch();
    if (processed === 0) break;
    totalProcessed += processed;
    // eslint-disable-next-line no-console
    console.log(`  - ${totalProcessed}건 처리 완료`);
  }

  const remaining = await verify();
  if (remaining > 0) {
    // eslint-disable-next-line no-console
    console.error(`검증 실패: dayBucket='' 또는 hourBucket<0 인 행이 ${remaining}건 남아 있습니다.`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`백필 완료. 총 ${totalProcessed}건 처리, 검증 쿼리 0건 확인.`);
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
