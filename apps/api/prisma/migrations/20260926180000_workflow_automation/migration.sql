-- [신규 2026-09-26 No.41] 업무 자동화 워크플로우 커넥터 — 전부 CREATE(기존 테이블 재정의 0 · ALTER 0
-- · 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/workflow-automation-설계.md` §3.2 근거.

-- CreateTable
CREATE TABLE "workflow_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'NONE',
    "authHeaderName" TEXT,
    "secretRef" TEXT,
    "signingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "signingSecretRef" TEXT,
    "urlSecretRef" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "allowRawPersonalData" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_targets_nameNormalized_key" ON "workflow_targets"("nameNormalized");

-- CreateIndex
CREATE INDEX "workflow_targets_updatedAt_idx" ON "workflow_targets"("updatedAt");

-- CreateTable
CREATE TABLE "workflow_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedAt" DATETIME,
    "conditions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workflow_subscriptions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "workflow_subscriptions_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "workflow_targets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_subscriptions_chatbotId_eventType_targetId_key" ON "workflow_subscriptions"("chatbotId", "eventType", "targetId");

-- CreateIndex
CREATE INDEX "workflow_subscriptions_targetId_idx" ON "workflow_subscriptions"("targetId");

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "chatbotId" TEXT,
    "triggerKind" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actionKey" TEXT,
    "nodeId" TEXT,
    "outputIndex" INTEGER,
    "subscriptionId" TEXT,
    "messageId" TEXT,
    "sourceRefId" TEXT,
    "dedupeKey" TEXT,
    "sessionRef" TEXT,
    "servedVersionId" TEXT,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "holdReason" TEXT,
    "heldAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastOutcome" TEXT,
    "lastHttpStatus" INTEGER,
    "lastLatencyMs" INTEGER,
    "personalDataMasked" BOOLEAN NOT NULL DEFAULT false,
    "fieldNames" TEXT NOT NULL DEFAULT '[]',
    "payload" TEXT,
    "payloadBytes" INTEGER,
    "payloadPurgedAt" DATETIME,
    "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastManualRetryAt" DATETIME,
    "firstSentAt" DATETIME,
    "completedAt" DATETIME,
    "deliveryLatencyMs" INTEGER,
    "dayBucket" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_dedupeKey_key" ON "workflow_runs"("dedupeKey");

-- CreateIndex
CREATE INDEX "workflow_runs_status_nextAttemptAt_idx" ON "workflow_runs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "workflow_runs_status_claimedAt_idx" ON "workflow_runs"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "workflow_runs_status_completedAt_idx" ON "workflow_runs"("status", "completedAt");

-- CreateIndex
CREATE INDEX "workflow_runs_targetId_status_idx" ON "workflow_runs"("targetId", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_targetId_sessionRef_createdAt_idx" ON "workflow_runs"("targetId", "sessionRef", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_runs_subscriptionId_status_idx" ON "workflow_runs"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_chatbotId_createdAt_idx" ON "workflow_runs"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_runs_createdAt_idx" ON "workflow_runs"("createdAt");
