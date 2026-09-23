-- CreateTable
CREATE TABLE "deploy_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "targetVersionId" TEXT,
    "targetVersionNo" INTEGER,
    "targetContentHash" TEXT,
    "expectedContentHash" TEXT,
    "predecessorScheduleId" TEXT,
    "acknowledgeActive" BOOLEAN NOT NULL DEFAULT false,
    "postRunTestSetId" TEXT,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "lastTransientReason" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "delaySeconds" INTEGER,
    "outcome" TEXT,
    "failureReason" TEXT,
    "resultSummary" TEXT,
    "heldReason" TEXT,
    "heldByScheduleId" TEXT,
    "heldAt" DATETIME,
    "testRunId" TEXT,
    "memo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelledByEmail" TEXT,
    "acknowledgedAt" DATETIME,
    "acknowledgedById" TEXT,
    "acknowledgedByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "deploy_schedules_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "deploy_schedules_status_scheduledAt_idx" ON "deploy_schedules"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "deploy_schedules_chatbotId_scheduledAt_idx" ON "deploy_schedules"("chatbotId", "scheduledAt");

-- CreateIndex
CREATE INDEX "deploy_schedules_chatbotId_status_idx" ON "deploy_schedules"("chatbotId", "status");

-- CreateIndex
CREATE INDEX "deploy_schedules_targetVersionId_status_idx" ON "deploy_schedules"("targetVersionId", "status");

-- [신규 2026-09-23 No.28] 부분 유니크 인덱스 2개(scheduled-deploy-설계.md §4.2) — Prisma 스키마
-- 언어는 WHERE 절 부분 인덱스를 표현하지 못해 raw SQL로만 존재한다(test_runs_chatbotId_active_key 선례).

-- ① 같은 챗봇의 활성 예약(PENDING/HELD/RUNNING)은 같은 분(scheduledAt)에 2건 이상 존재할 수 없다.
--    scheduledAt이 분 단위로 정규화되므로 "서로 다른 분" ⇔ "최소 1분 간격"의 DB 차원 최종 방어선이다.
CREATE UNIQUE INDEX "deploy_schedules_chatbotId_scheduledAt_active_key"
  ON "deploy_schedules"("chatbotId", "scheduledAt") WHERE "status" IN ('PENDING', 'HELD', 'RUNNING');

-- ② 한 챗봇에서 RUNNING은 최대 1건 — 다중 인스턴스에서도 챗봇 단위 직렬 실행(순서 보장)의 최종 방어선.
CREATE UNIQUE INDEX "deploy_schedules_chatbotId_running_key"
  ON "deploy_schedules"("chatbotId") WHERE "status" = 'RUNNING';
