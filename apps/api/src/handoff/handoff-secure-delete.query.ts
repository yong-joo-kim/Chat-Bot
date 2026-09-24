import type { Prisma } from '@prisma/client';

/**
 * `PRAGMA secure_delete = ON`(§9.2) — 원문 소거 트랜잭션이 SQLite 페이지에 남길 수 있는 옛 값을
 * 덮어써 지운다. 원시 SQL은 이 파일 1줄로 격리한다(R-7 — `$queryRaw` 보유 파일 3 → 4, E-6).
 * Postgres에서는 호출하지 않는다(VACUUM 정책으로 대체 — 재검토 트리거).
 */
export async function enableSecureDelete(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`PRAGMA secure_delete = ON`;
}
