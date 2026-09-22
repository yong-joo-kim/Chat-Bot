/*
  Warnings:

  - You are about to drop the column `suggestedIntentName` on the `unanswered_questions` table. All the data in the column will be lost.
  - Added the required column `questionNormalized` to the `unanswered_questions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `unanswered_questions` table without a default value. This is not possible if the table is not empty.

*/
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_logs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_conversation_logs" ("blockedByFilter", "botResponse", "channelType", "chatbotId", "createdAt", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage") SELECT "blockedByFilter", "botResponse", "channelType", "chatbotId", "createdAt", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage" FROM "conversation_logs";
DROP TABLE "conversation_logs";
ALTER TABLE "new_conversation_logs" RENAME TO "conversation_logs";
CREATE INDEX "conversation_logs_chatbotId_createdAt_idx" ON "conversation_logs"("chatbotId", "createdAt");
CREATE INDEX "conversation_logs_chatbotId_dayBucket_idx" ON "conversation_logs"("chatbotId", "dayBucket");
CREATE TABLE "new_unanswered_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionNormalized" TEXT NOT NULL,
    "variants" TEXT NOT NULL DEFAULT '[]',
    "occurredCount" INTEGER NOT NULL DEFAULT 1,
    "lastOccurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recurredCount" INTEGER NOT NULL DEFAULT 0,
    "recurredAfterAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'UNANSWERED',
    "channelType" TEXT,
    "resolvedIntentId" TEXT,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "unanswered_questions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_unanswered_questions" ("chatbotId", "createdAt", "id", "occurredCount", "questionText", "status") SELECT "chatbotId", "createdAt", "id", "occurredCount", "questionText", "status" FROM "unanswered_questions";
DROP TABLE "unanswered_questions";
ALTER TABLE "new_unanswered_questions" RENAME TO "unanswered_questions";
CREATE INDEX "unanswered_questions_chatbotId_status_occurredCount_idx" ON "unanswered_questions"("chatbotId", "status", "occurredCount");
CREATE INDEX "unanswered_questions_chatbotId_lastOccurredAt_idx" ON "unanswered_questions"("chatbotId", "lastOccurredAt");
CREATE UNIQUE INDEX "unanswered_questions_chatbotId_questionNormalized_key" ON "unanswered_questions"("chatbotId", "questionNormalized");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
