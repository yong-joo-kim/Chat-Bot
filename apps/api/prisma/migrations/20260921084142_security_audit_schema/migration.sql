/*
  Warnings:

  - Added the required column `passwordHash` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "actorEmail" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "actorRole" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "chatbotId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "ip" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "summary" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "targetName" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "userAgent" TEXT;

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "absoluteExpiresAt" DATETIME NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "revokedAt" DATETIME,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "banned_words" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "word" TEXT NOT NULL,
    "wordNormalized" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'CONTAINS',
    "policy" TEXT NOT NULL DEFAULT 'BLOCK',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channels_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_channels" ("chatbotId", "config", "createdAt", "enabled", "id", "type", "updatedAt") SELECT "chatbotId", "config", "createdAt", "enabled", "id", "type", "updatedAt" FROM "channels";
DROP TABLE "channels";
ALTER TABLE "new_channels" RENAME TO "channels";
CREATE UNIQUE INDEX "channels_chatbotId_type_key" ON "channels"("chatbotId", "type");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_logs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_conversation_logs" ("botResponse", "channelType", "chatbotId", "createdAt", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage") SELECT "botResponse", "channelType", "chatbotId", "createdAt", "id", "isAnswered", "matchedFaqId", "matchedIntentId", "matchedNodeId", "sessionId", "userMessage" FROM "conversation_logs";
DROP TABLE "conversation_logs";
ALTER TABLE "new_conversation_logs" RENAME TO "conversation_logs";
CREATE INDEX "conversation_logs_chatbotId_createdAt_idx" ON "conversation_logs"("chatbotId", "createdAt");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_users" ("createdAt", "email", "id", "name", "role") SELECT "createdAt", "email", "id", "name", "role" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_status_createdAt_idx" ON "users"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "banned_words_wordNormalized_key" ON "banned_words"("wordNormalized");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_chatbotId_createdAt_idx" ON "audit_logs"("chatbotId", "createdAt");
