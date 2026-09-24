-- No.26 레거시 API 연동(ADR-0034) — 비파괴 변경만(CREATE TABLE ×2 + ALTER TABLE ADD COLUMN ×2).
-- 기존 행·컬럼 변경 0 · 백필 0. 롤백 = 두 테이블 DROP + 두 컬럼 제거.
-- v1 API_CONDITION 데이터는 마이그레이션하지 않는다(P-4 — 자동 변환·스크럽 없음, ADR-0034 §7).

-- CreateTable
CREATE TABLE "api_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT NOT NULL,
    "allowedMethods" TEXT NOT NULL DEFAULT '["GET"]',
    "authType" TEXT NOT NULL DEFAULT 'NONE',
    "authHeaderName" TEXT,
    "secretRef" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 3000,
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 120,
    "allowRawPersonalData" BOOLEAN NOT NULL DEFAULT false,
    "personalDataLookup" BOOLEAN NOT NULL DEFAULT false,
    "sampleResponses" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "api_connections_nameNormalized_key" ON "api_connections"("nameNormalized");

-- CreateIndex
CREATE INDEX "api_connections_updatedAt_idx" ON "api_connections"("updatedAt");

-- CreateTable
CREATE TABLE "api_call_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT,
    "connectionId" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "nodeId" TEXT,
    "conversationLogId" TEXT,
    "source" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pathTemplate" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "responseBytes" INTEGER,
    "branch" TEXT,
    "conditionIndex" INTEGER,
    "personalDataMasked" BOOLEAN NOT NULL DEFAULT false,
    "dayBucket" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "api_call_logs_chatbotId_dayBucket_idx" ON "api_call_logs"("chatbotId", "dayBucket");

-- CreateIndex
CREATE INDEX "api_call_logs_chatbotId_createdAt_idx" ON "api_call_logs"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "api_call_logs_connectionId_createdAt_idx" ON "api_call_logs"("connectionId", "createdAt");

-- AlterTable
ALTER TABLE "test_run_results" ADD COLUMN "apiMockA" TEXT;

-- AlterTable
ALTER TABLE "test_run_results" ADD COLUMN "apiMockB" TEXT;
