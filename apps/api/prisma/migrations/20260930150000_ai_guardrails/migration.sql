-- [신규 2026-09-30 No.36] AI 거버넌스·가드레일 — 신규 테이블 4(위험 응답 규칙 · 출구 가림 설정 · 판정 이벤트 ·
-- 운영 전환 승인 요청) + ADD COLUMN 5(conversation_logs.guardrailStage · environment_switch_logs.approvalRequestId/
-- approvalMode · chatbot_environments.approvalRequired/approvalTtlHours). 테이블 재정의 0(prisma migrate diff가
-- chatbot_environments를 재정의로 냈으나 ADD COLUMN으로 손으로 바꿨다) ·
-- 원시 부분 유니크 4종 보존 · 백필 0. `docs/02-spec/ai-guardrails-설계.md` §12 · ADR-0048 근거.

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "guardrailStage" TEXT;

-- AlterTable
ALTER TABLE "chatbot_environments" ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chatbot_environments" ADD COLUMN "approvalTtlHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "environment_switch_logs" ADD COLUMN "approvalMode" TEXT;
ALTER TABLE "environment_switch_logs" ADD COLUMN "approvalRequestId" TEXT;

-- CreateTable
CREATE TABLE "guardrail_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "expressions" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'CONTAINS',
    "appliesTo" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'MONITOR',
    "replacementText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "updatedById" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "guardrail_rules_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chatbot_guardrail_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "piiExitKinds" TEXT NOT NULL DEFAULT '["RRN","CARD"]',
    "piiPreserveDates" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedByEmail" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_guardrail_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardrail_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "category" TEXT,
    "ruleAction" TEXT,
    "appliedAction" TEXT NOT NULL,
    "decisive" BOOLEAN NOT NULL DEFAULT false,
    "effect" TEXT NOT NULL,
    "piiKind" TEXT,
    "piiCount" INTEGER,
    "errorCode" TEXT,
    "dayBucket" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "prod_switch_approval_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "targetVersionNo" INTEGER NOT NULL,
    "baseProdVersionId" TEXT NOT NULL,
    "baseProdVersionNo" INTEGER NOT NULL,
    "deployScheduleId" TEXT,
    "gateSnapshot" TEXT NOT NULL,
    "warningCodes" TEXT NOT NULL,
    "diffChangedCount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "failureCode" TEXT,
    "closedReason" TEXT,
    "decisionNote" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedByEmail" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedByEmail" TEXT,
    "decidedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "pendingLock" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "prod_switch_approval_requests_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "guardrail_rules_chatbotId_sortOrder_idx" ON "guardrail_rules"("chatbotId", "sortOrder");

-- CreateIndex
CREATE INDEX "guardrail_rules_enabled_chatbotId_idx" ON "guardrail_rules"("enabled", "chatbotId");

-- CreateIndex
CREATE UNIQUE INDEX "guardrail_rules_chatbotId_nameNormalized_key" ON "guardrail_rules"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE INDEX "guardrail_events_chatbotId_dayBucket_idx" ON "guardrail_events"("chatbotId", "dayBucket");

-- CreateIndex
CREATE INDEX "guardrail_events_chatbotId_ruleId_dayBucket_idx" ON "guardrail_events"("chatbotId", "ruleId", "dayBucket");

-- CreateIndex
CREATE INDEX "guardrail_events_chatbotId_createdAt_idx" ON "guardrail_events"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "guardrail_events_messageId_idx" ON "guardrail_events"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "prod_switch_approval_requests_pendingLock_key" ON "prod_switch_approval_requests"("pendingLock");

-- CreateIndex
CREATE INDEX "prod_switch_approval_requests_chatbotId_createdAt_idx" ON "prod_switch_approval_requests"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "prod_switch_approval_requests_status_expiresAt_idx" ON "prod_switch_approval_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "prod_switch_approval_requests_deployScheduleId_idx" ON "prod_switch_approval_requests"("deployScheduleId");

