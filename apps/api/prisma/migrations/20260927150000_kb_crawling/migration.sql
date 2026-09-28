-- [신규 2026-09-27 No.43] 지식베이스 자동 크롤링/동기화 — 전부 CREATE(기존 테이블 재정의 0 · ALTER 0 ·
-- 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/kb-crawling-설계.md` §3.2 근거.

-- CreateTable
CREATE TABLE "kb_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "seedUrls" TEXT NOT NULL DEFAULT '[]',
    "sitemapUrls" TEXT NOT NULL DEFAULT '[]',
    "allowedHosts" TEXT NOT NULL DEFAULT '[]',
    "pathPrefixes" TEXT NOT NULL DEFAULT '[]',
    "excludePatterns" TEXT NOT NULL DEFAULT '[]',
    "noisePatterns" TEXT NOT NULL DEFAULT '[]',
    "allowQueryUrls" BOOLEAN NOT NULL DEFAULT false,
    "maxDepth" INTEGER NOT NULL DEFAULT 3,
    "maxPages" INTEGER NOT NULL DEFAULT 500,
    "fileTypes" TEXT NOT NULL DEFAULT '[]',
    "maxFileBytes" INTEGER NOT NULL DEFAULT 20971520,
    "minIntervalMs" INTEGER NOT NULL DEFAULT 1000,
    "scopeCompany" TEXT NOT NULL,
    "scopeCategory" TEXT NOT NULL,
    "scopeSubcategory" TEXT NOT NULL,
    "scheduleKind" TEXT NOT NULL DEFAULT 'MANUAL',
    "scheduleTime" TEXT,
    "scheduleWeekday" INTEGER,
    "authKind" TEXT NOT NULL DEFAULT 'NONE',
    "authHeaderName" TEXT,
    "authSecretRef" TEXT,
    "piiMask" BOOLEAN NOT NULL DEFAULT true,
    "allowRawFileIngest" BOOLEAN NOT NULL DEFAULT false,
    "rightsConfirmedById" TEXT NOT NULL,
    "rightsConfirmedAt" DATETIME NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "approvedConfigVersion" INTEGER,
    "approvedAt" DATETIME,
    "approvedById" TEXT,
    "reviewRequiredReason" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activeRunId" TEXT,
    "nextRunAt" DATETIME,
    "lastRunId" TEXT,
    "lastRunStatus" TEXT,
    "lastRunFinishedAt" DATETIME,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "kb_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalFileName" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "excludeReason" TEXT,
    "cleanupReason" TEXT,
    "missingStreak" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "contentHash" TEXT,
    "ingestFingerprint" TEXT,
    "textLength" INTEGER,
    "byteSize" INTEGER,
    "lastIngestedAt" DATETIME,
    "lastIngestJobId" TEXT,
    "activeIngestJobId" TEXT,
    "consecutiveIngestFailures" INTEGER NOT NULL DEFAULT 0,
    "seenRunId" TEXT,
    "visitState" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "discoveredSeq" INTEGER NOT NULL DEFAULT 0,
    "observedChange" TEXT,
    "observedPiiMasked" INTEGER,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kb_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "kb_sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "resumedCount" INTEGER NOT NULL DEFAULT 0,
    "counts" TEXT NOT NULL DEFAULT '{}',
    "maxPagesReached" BOOLEAN NOT NULL DEFAULT false,
    "abortedHosts" TEXT NOT NULL DEFAULT '[]',
    "demotedReason" TEXT,
    "failureCode" TEXT,
    "cancelRequestedAt" DATETIME,
    "createdById" TEXT,
    "cancelledById" TEXT,
    "startedAt" DATETIME,
    "crawlFinishedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "kb_ingest_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "notFoundResubmitted" BOOLEAN NOT NULL DEFAULT false,
    "slotToken" TEXT,
    "taskId" TEXT,
    "submittedAt" DATETIME,
    "lastPolledAt" DATETIME,
    "completedAt" DATETIME,
    "fileKind" TEXT,
    "externalFileName" TEXT,
    "contentHash" TEXT,
    "ingestFingerprint" TEXT,
    "textLength" INTEGER,
    "byteSize" INTEGER,
    "piiMaskedCount" INTEGER,
    "resultCode" TEXT,
    "httpStatus" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "kb_job_leases" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "claimToken" TEXT,
    "claimedAt" DATETIME,
    "holderJobId" TEXT,
    "state" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "kb_sources_nameNormalized_key" ON "kb_sources"("nameNormalized");

-- CreateIndex
CREATE INDEX "kb_sources_enabled_nextRunAt_idx" ON "kb_sources"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "kb_sources_updatedAt_idx" ON "kb_sources"("updatedAt");

-- CreateIndex
CREATE INDEX "kb_documents_sourceId_seenRunId_visitState_depth_discoveredSeq_idx" ON "kb_documents"("sourceId", "seenRunId", "visitState", "depth", "discoveredSeq");

-- CreateIndex
CREATE INDEX "kb_documents_sourceId_state_idx" ON "kb_documents"("sourceId", "state");

-- CreateIndex
CREATE INDEX "kb_documents_sourceId_cleanupReason_idx" ON "kb_documents"("sourceId", "cleanupReason");

-- CreateIndex
CREATE UNIQUE INDEX "kb_documents_sourceId_urlHash_key" ON "kb_documents"("sourceId", "urlHash");

-- CreateIndex
CREATE INDEX "kb_sync_runs_sourceId_createdAt_idx" ON "kb_sync_runs"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "kb_sync_runs_status_claimedAt_idx" ON "kb_sync_runs"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "kb_sync_runs_createdAt_idx" ON "kb_sync_runs"("createdAt");

-- CreateIndex
CREATE INDEX "kb_ingest_jobs_status_lane_nextAttemptAt_createdAt_idx" ON "kb_ingest_jobs"("status", "lane", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "kb_ingest_jobs_runId_status_idx" ON "kb_ingest_jobs"("runId", "status");

-- CreateIndex
CREATE INDEX "kb_ingest_jobs_documentId_status_idx" ON "kb_ingest_jobs"("documentId", "status");

-- CreateIndex
CREATE INDEX "kb_ingest_jobs_createdAt_idx" ON "kb_ingest_jobs"("createdAt");

