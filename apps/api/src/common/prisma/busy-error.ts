import { Prisma } from '@prisma/client';

/**
 * DB 쓰기 경합(직렬화 실패/SQLITE_BUSY) 판별 — 공용화(§9.1, FR-D3-9).
 * `versions/restore/version-restore.service.ts`에서 이동했다. 즉시 복원 경로는 이 신호를
 * `RESTORE_BUSY`(409)로, 운영 예약 배포 실행기는 `outcome-classifier`의 `TRANSIENT(DB_BUSY)`로 매핑한다.
 * Postgres 전환 시 `P2034`(직렬화 실패)도 같은 판정을 받는다(개발명세서 §5 DB 이식성).
 */
export function isBusyError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return true;
  const message = e instanceof Error ? e.message : '';
  return /SQLITE_BUSY|database is locked/i.test(message);
}
