-- CreateTable
CREATE TABLE "chatbot_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerContext" TEXT,
    "schemaVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "payloadEncoding" TEXT NOT NULL DEFAULT 'json',
    "integrityWarnings" TEXT NOT NULL DEFAULT '[]',
    "integrityWarningCount" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "memo" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "restoredFromVersionId" TEXT,
    "restoredFromVersionNo" INTEGER,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_versions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chatbot_version_payloads" (
    "versionId" TEXT NOT NULL PRIMARY KEY,
    "payload" TEXT NOT NULL,
    CONSTRAINT "chatbot_version_payloads_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "chatbot_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chatbot_version_sequences" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "lastVersionNo" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "chatbot_version_sequences_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "chatbot_versions_chatbotId_createdAt_idx" ON "chatbot_versions"("chatbotId", "createdAt");

-- CreateIndex
CREATE INDEX "chatbot_versions_chatbotId_trigger_createdAt_idx" ON "chatbot_versions"("chatbotId", "trigger", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_versions_chatbotId_versionNo_key" ON "chatbot_versions"("chatbotId", "versionNo");

