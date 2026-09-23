-- CreateTable
CREATE TABLE "test_case_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_case_sets_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "messages" TEXT NOT NULL,
    "messagesNormalized" TEXT NOT NULL,
    "expectedKind" TEXT NOT NULL,
    "expectedTargetId" TEXT,
    "expectedAnswerNote" TEXT,
    "tags" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_cases_setId_fkey" FOREIGN KEY ("setId") REFERENCES "test_case_sets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SINGLE',
    "overlaySource" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "envFingerprint" TEXT,
    "degradedMode" BOOLEAN NOT NULL DEFAULT false,
    "useRag" BOOLEAN NOT NULL DEFAULT false,
    "ragCallCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_runs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "test_runs_setId_fkey" FOREIGN KEY ("setId") REFERENCES "test_case_sets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_run_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "expectedKind" TEXT NOT NULL,
    "expectedTargetId" TEXT,
    "resultA" TEXT NOT NULL,
    "matchedIntentIdA" TEXT,
    "matchedFaqIdA" TEXT,
    "matchedNodeIdA" TEXT,
    "bandA" TEXT,
    "top1ScoreA" REAL,
    "top1KindA" TEXT,
    "top1IdA" TEXT,
    "marginToTop2A" REAL,
    "outputsHashA" TEXT NOT NULL,
    "outputsPreviewA" TEXT,
    "unsupportedCountA" INTEGER NOT NULL DEFAULT 0,
    "blockedByFilterA" BOOLEAN NOT NULL DEFAULT false,
    "elapsedMsA" INTEGER NOT NULL DEFAULT 0,
    "resultB" TEXT,
    "matchedIntentIdB" TEXT,
    "matchedFaqIdB" TEXT,
    "matchedNodeIdB" TEXT,
    "bandB" TEXT,
    "top1ScoreB" REAL,
    "outputsHashB" TEXT,
    "outputsPreviewB" TEXT,
    "diffStatus" TEXT,
    "wouldUseRag" BOOLEAN NOT NULL DEFAULT false,
    "ragAttempted" BOOLEAN NOT NULL DEFAULT false,
    "ragLatencyMs" INTEGER,
    "ragSourceCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "test_run_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "test_case_sets_chatbotId_updatedAt_idx" ON "test_case_sets"("chatbotId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_sets_chatbotId_nameNormalized_key" ON "test_case_sets"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE INDEX "test_cases_setId_seq_idx" ON "test_cases"("setId", "seq");

-- CreateIndex
CREATE INDEX "test_cases_chatbotId_idx" ON "test_cases"("chatbotId");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_setId_messagesNormalized_key" ON "test_cases"("setId", "messagesNormalized");

-- CreateIndex
CREATE INDEX "test_runs_chatbotId_setId_createdAt_idx" ON "test_runs"("chatbotId", "setId", "createdAt");

-- CreateIndex
CREATE INDEX "test_runs_chatbotId_status_idx" ON "test_runs"("chatbotId", "status");

-- CreateIndex
CREATE INDEX "test_run_results_runId_resultA_idx" ON "test_run_results"("runId", "resultA");

-- CreateIndex
CREATE INDEX "test_run_results_runId_caseId_idx" ON "test_run_results"("runId", "caseId");

-- CreateIndex (partial unique — code-review 대응: 챗봇당 동시 실행 1건, TOCTOU 방어 최종 방어선)
-- Prisma 스키마 언어는 WHERE 절 부분 인덱스를 표현하지 못해 raw SQL로만 존재한다(schema.prisma 하단 주석 참고).
CREATE UNIQUE INDEX "test_runs_chatbotId_active_key" ON "test_runs"("chatbotId") WHERE "status" IN ('QUEUED', 'RUNNING');
