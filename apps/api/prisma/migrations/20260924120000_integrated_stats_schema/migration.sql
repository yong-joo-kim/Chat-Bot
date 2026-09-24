-- No.29 통합 통계(ADR-0033) — 비파괴 ADD COLUMN + CREATE INDEX만. 테이블 재생성(DROP TABLE) 없음.
-- `prisma migrate diff`는 conversation_logs의 신규 컬럼이 모델 선언 순서상 마지막이 아니라는 이유로
-- RedefineTables(전체 재생성)를 제안했다 — 설계서 §3.2 지시에 따라 수기로 최소 변경 SQL을 작성한다.

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "groupId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "chatbot_groups" ADD COLUMN "archivedAt" DATETIME;

-- AlterTable
ALTER TABLE "chatbots" ADD COLUMN "archivedAt" DATETIME;

-- CreateIndex
CREATE INDEX "conversation_logs_groupId_dayBucket_idx" ON "conversation_logs"("groupId", "dayBucket");

-- CreateIndex
CREATE INDEX "conversation_logs_dayBucket_idx" ON "conversation_logs"("dayBucket");

-- 보관 챗봇의 보관일 근사 백필(§3.2) — updatedAt이 보관 시각의 근사치다(표시 전용).
UPDATE "chatbots" SET "archivedAt" = "updatedAt" WHERE "status" = 'ARCHIVED' AND "archivedAt" IS NULL;
