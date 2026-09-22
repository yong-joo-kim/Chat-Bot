-- CreateTable
CREATE TABLE "embedding_vectors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL DEFAULT 0,
    "textHash" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "embedding_vectors_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chatbot_answer_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "semanticEnabled" BOOLEAN NOT NULL DEFAULT false,
    "acceptThreshold" REAL NOT NULL DEFAULT 0.80,
    "lowThreshold" REAL NOT NULL DEFAULT 0.60,
    "marginThreshold" REAL NOT NULL DEFAULT 0.05,
    "ragEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ragCompany" TEXT,
    "ragCategory" TEXT,
    "ragSubcategory" TEXT,
    "ragSimilarityThreshold" REAL,
    "fallbackPolicy" TEXT NOT NULL DEFAULT 'RAG_FIRST',
    "showSources" BOOLEAN NOT NULL DEFAULT true,
    "ragTimeoutMs" INTEGER NOT NULL DEFAULT 120000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_answer_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rag_call_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "conversationLogId" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retrievalSuccess" INTEGER,
    "sourceCount" INTEGER,
    "scopeCompany" TEXT,
    "dayBucket" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversation_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "sessionId" TEXT,
    "userMessage" TEXT NOT NULL,
    "botResponse" TEXT NOT NULL,
    "matchedIntentId" TEXT,
    "matchedNodeId" TEXT,
    "matchedFaqId" TEXT,
    "isAnswered" BOOLEAN NOT NULL DEFAULT true,
    "blockedByFilter" BOOLEAN NOT NULL DEFAULT false,
    "dayBucket" TEXT NOT NULL DEFAULT '',
    "hourBucket" INTEGER NOT NULL DEFAULT -1,
    "answeredByRag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_logs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_conversation_logs" ("blockedByFilter", "botResponse", "channelType", "chatbotId", "createdAt", "dayBucket", "hourBucket", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage") SELECT "blockedByFilter", "botResponse", "channelType", "chatbotId", "createdAt", "dayBucket", "hourBucket", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage" FROM "conversation_logs";
DROP TABLE "conversation_logs";
ALTER TABLE "new_conversation_logs" RENAME TO "conversation_logs";
CREATE INDEX "conversation_logs_chatbotId_createdAt_idx" ON "conversation_logs"("chatbotId", "createdAt");
CREATE INDEX "conversation_logs_chatbotId_dayBucket_idx" ON "conversation_logs"("chatbotId", "dayBucket");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "embedding_vectors_chatbotId_modelId_status_idx" ON "embedding_vectors"("chatbotId", "modelId", "status");

-- CreateIndex
CREATE INDEX "embedding_vectors_chatbotId_ownerType_ownerId_idx" ON "embedding_vectors"("chatbotId", "ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_vectors_chatbotId_ownerType_ownerId_slotIndex_modelId_key" ON "embedding_vectors"("chatbotId", "ownerType", "ownerId", "slotIndex", "modelId");

-- CreateIndex
CREATE INDEX "rag_call_logs_chatbotId_dayBucket_idx" ON "rag_call_logs"("chatbotId", "dayBucket");

-- CreateIndex
CREATE INDEX "rag_call_logs_chatbotId_createdAt_idx" ON "rag_call_logs"("chatbotId", "createdAt");
