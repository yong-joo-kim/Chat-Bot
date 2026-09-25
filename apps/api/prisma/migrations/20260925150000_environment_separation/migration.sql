-- No.40 환경분리 커밋 ② (ADR-0039). 비파괴 변경만. 기존 행 값 변경 0 · 백필 0 · 테이블 재정의 0.
-- ADD COLUMN x5 + CREATE INDEX x4 + CREATE TABLE x3.
-- ⚠ 원시 부분 유니크 인덱스 4개(test_runs_chatbotId_active_key · deploy_schedules 2 ·
--   handoff_sessions_active_key)가 있는 테이블(test_runs)에 ADD COLUMN·CREATE INDEX만 한다 —
--   RedefineTables가 없으므로 삭제될 경로가 없다.

-- AlterTable
ALTER TABLE "chatbots" ADD COLUMN "prodVersionId" TEXT;
ALTER TABLE "conversation_logs" ADD COLUMN "servedVersionId" TEXT;
ALTER TABLE "test_runs" ADD COLUMN "targetKind" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "test_runs" ADD COLUMN "targetVersionId" TEXT;
ALTER TABLE "test_runs" ADD COLUMN "targetVersionNo" INTEGER;
CREATE INDEX "test_runs_chatbotId_targetVersionId_idx" ON "test_runs"("chatbotId", "targetVersionId");

-- CreateTable
CREATE TABLE "chatbot_environments" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "stagingVersionId" TEXT,
    "enabledAt" DATETIME,
    "enabledById" TEXT,
    "enabledByEmail" TEXT,
    "gateMode" TEXT NOT NULL DEFAULT 'WARN',
    "gateTestSetId" TEXT,
    "gateMinPassRate" INTEGER NOT NULL DEFAULT 95,
    "gateValidHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_environments_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "environment_switch_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "fromVersionId" TEXT,
    "fromVersionNo" INTEGER,
    "toVersionId" TEXT,
    "toVersionNo" INTEGER,
    "toVersionCapturedAt" DATETIME,
    "deployScheduleId" TEXT,
    "disableMode" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "environment_switch_logs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "environment_switch_logs_chatbotId_environment_createdAt_idx" ON "environment_switch_logs"("chatbotId", "environment", "createdAt");

CREATE TABLE "embedding_text_vectors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embedding_text_vectors_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "embedding_text_vectors_chatbotId_modelId_textHash_key" ON "embedding_text_vectors"("chatbotId", "modelId", "textHash");
