-- [신규 2026-09-30 No.21] 발화 묶음 분석(딥러닝 군집분석) — 전부 CREATE(기존 테이블 재정의 0 · ALTER 0 ·
-- 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/deep-clustering-설계.md` §10 · ADR-0047 근거.
-- prisma migrate diff 산출물에 인덱스 삭제 줄은 없었다(부분 인덱스 4개는 그대로).

-- CreateTable
CREATE TABLE "utterance_analyses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "activeLock" TEXT,
    "resultsCommittedAt" DATETIME,
    "fileName" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "notices" TEXT NOT NULL DEFAULT '[]',
    "embeddingModelId" TEXT,
    "algorithmVersion" TEXT NOT NULL,
    "analyzerId" TEXT,
    "probeStatus" TEXT NOT NULL DEFAULT 'OFF',
    "probeFailureReason" TEXT,
    "probeTargetKind" TEXT,
    "probeVersionId" TEXT,
    "probeVersionNo" INTEGER,
    "probeContentHash" TEXT,
    "probeThreshold" REAL,
    "nameSuggestStatus" TEXT NOT NULL DEFAULT 'OFF',
    "nameSuggestFailureReason" TEXT,
    "clusterCount" INTEGER,
    "unassignedCount" INTEGER,
    "candidateCount" INTEGER,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "requestedById" TEXT,
    "requestedByEmail" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "utterance_analyses_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "utterance_clusters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "unassigned" BOOLEAN NOT NULL DEFAULT false,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "autoName" TEXT NOT NULL,
    "customName" TEXT,
    "suggestedName" TEXT,
    "utteranceCount" INTEGER NOT NULL,
    "occurrenceSum" INTEGER NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "representativeSeqs" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "utterance_clusters_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "utterance_analyses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "analyzed_utterances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "textNormalized" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "sourceMemo" TEXT,
    "hasBannedWord" BOOLEAN NOT NULL DEFAULT false,
    "hasMaskToken" BOOLEAN NOT NULL DEFAULT false,
    "similarityToCentroid" REAL,
    "probeAnswered" BOOLEAN,
    "probeMatchKind" TEXT,
    "probeMatchId" TEXT,
    "probeMatchName" TEXT,
    "probeBand" TEXT,
    "probeScore" REAL,
    "wouldUseRag" BOOLEAN NOT NULL DEFAULT false,
    "learningCandidate" BOOLEAN NOT NULL DEFAULT false,
    "suggestedIntents" TEXT NOT NULL DEFAULT '[]',
    "appliedIntentId" TEXT,
    "appliedIntentName" TEXT,
    "appliedById" TEXT,
    "appliedByEmail" TEXT,
    "appliedAt" DATETIME,
    CONSTRAINT "analyzed_utterances_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "utterance_analyses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "analyzed_utterances_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "utterance_clusters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "utterance_analyses_activeLock_key" ON "utterance_analyses"("activeLock");

-- CreateIndex
CREATE INDEX "utterance_analyses_chatbotId_createdAt_idx" ON "utterance_analyses"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "utterance_analyses_expiresAt_status_idx" ON "utterance_analyses"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "utterance_clusters_analysisId_ordinal_key" ON "utterance_clusters"("analysisId", "ordinal");

-- CreateIndex
CREATE INDEX "analyzed_utterances_analysisId_clusterId_seq_idx" ON "analyzed_utterances"("analysisId", "clusterId", "seq");

-- CreateIndex
CREATE INDEX "analyzed_utterances_analysisId_learningCandidate_seq_idx" ON "analyzed_utterances"("analysisId", "learningCandidate", "seq");

-- CreateIndex
CREATE INDEX "analyzed_utterances_clusterId_idx" ON "analyzed_utterances"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "analyzed_utterances_analysisId_seq_key" ON "analyzed_utterances"("analysisId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "analyzed_utterances_analysisId_textNormalized_key" ON "analyzed_utterances"("analysisId", "textNormalized");

