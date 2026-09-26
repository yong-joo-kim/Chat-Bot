-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "rowHash" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "seq" INTEGER;

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "textPurgedAt" DATETIME;

-- AlterTable
ALTER TABLE "handoff_messages" ADD COLUMN "textPurgedAt" DATETIME;

-- AlterTable
ALTER TABLE "survey_answers" ADD COLUMN "textPurgedAt" DATETIME;

-- AlterTable
ALTER TABLE "unanswered_questions" ADD COLUMN "textPurgedAt" DATETIME;

-- CreateTable
CREATE TABLE "retention_policies" (
    "scopeKey" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT,
    "days" TEXT NOT NULL DEFAULT '{}',
    "pending" TEXT NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "retention_policies_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "retention_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "chatbotId" TEXT,
    "days" INTEGER,
    "cutoff" DATETIME,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "resultCode" TEXT,
    "headSeq" INTEGER,
    "headHash" TEXT,
    "anchorSeq" INTEGER,
    "instanceId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "audit_chain_heads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "headSeq" INTEGER NOT NULL,
    "headHash" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_chain_anchors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seq" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "preChainRows" INTEGER,
    "preChainMaxCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "governance_job_states" (
    "jobName" TEXT NOT NULL PRIMARY KEY,
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "lastCompletedDay" TEXT,
    "state" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_chatbotId_key" ON "retention_policies"("chatbotId");

-- CreateIndex
CREATE INDEX "retention_runs_kind_startedAt_idx" ON "retention_runs"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "retention_runs_chatbotId_startedAt_idx" ON "retention_runs"("chatbotId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs"("seq");

-- CreateIndex
CREATE INDEX "conversation_logs_chatbotId_textPurgedAt_createdAt_idx" ON "conversation_logs"("chatbotId", "textPurgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "handoff_messages_chatbotId_textPurgedAt_createdAt_idx" ON "handoff_messages"("chatbotId", "textPurgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "survey_answers_surveyId_textPurgedAt_answeredAt_idx" ON "survey_answers"("surveyId", "textPurgedAt", "answeredAt");

