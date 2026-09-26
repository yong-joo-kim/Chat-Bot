-- [신규 2026-09-26 No.42] 옴니채널 통합 인박스 — 전부 CREATE(기존 테이블 재정의 0 · ALTER 0 ·
-- 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/omnichannel-inbox-설계.md` §3.2 근거.

-- CreateTable
CREATE TABLE "chatbot_inbox_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "identitySecretRef" TEXT,
    "openOnWarning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_inbox_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "identitySpaceRef" TEXT,
    "customerKeyHash" TEXT,
    "keyFingerprint" TEXT,
    "displayName" TEXT,
    "mergedIntoId" TEXT,
    "firstSeenAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL,
    "identityPurgedAt" DATETIME,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_ref_key" ON "customers"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customerKeyHash_key" ON "customers"("customerKeyHash");

-- CreateIndex
CREATE INDEX "customers_kind_lastActivityAt_idx" ON "customers"("kind", "lastActivityAt");

-- CreateIndex
CREATE INDEX "customers_lastActivityAt_idx" ON "customers"("lastActivityAt");

-- CreateIndex
CREATE INDEX "customers_identitySpaceRef_idx" ON "customers"("identitySpaceRef");

-- CreateTable
CREATE TABLE "customer_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionRef" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "previousCustomerId" TEXT,
    "previousSource" TEXT,
    "identityVerifiedAt" DATETIME,
    "identityBlockedAt" DATETIME,
    "warningOpenedAt" DATETIME,
    "linkedById" TEXT,
    "linkedByName" TEXT,
    "linkedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_links_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_links_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_links_chatbotId_sessionId_key" ON "customer_links"("chatbotId", "sessionId");

-- CreateIndex
CREATE INDEX "customer_links_chatbotId_sessionRef_idx" ON "customer_links"("chatbotId", "sessionRef");

-- CreateIndex
CREATE INDEX "customer_links_customerId_linkedAt_idx" ON "customer_links"("customerId", "linkedAt");

-- CreateTable
CREATE TABLE "inbox_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snoozeUntil" DATETIME,
    "openReason" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "assigneeUserName" TEXT,
    "lastActivityAt" DATETIME NOT NULL,
    "lastActivityKind" TEXT NOT NULL,
    "lastChannelFamily" TEXT,
    "lastChannelType" TEXT,
    "lastChatbotId" TEXT,
    "lastEntryId" TEXT,
    "hiddenByMergeId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inbox_threads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "inbox_threads_customerId_key" ON "inbox_threads"("customerId");

-- CreateIndex
CREATE INDEX "inbox_threads_status_lastActivityAt_idx" ON "inbox_threads"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "inbox_threads_assigneeUserId_status_lastActivityAt_idx" ON "inbox_threads"("assigneeUserId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "inbox_threads_status_snoozeUntil_idx" ON "inbox_threads"("status", "snoozeUntil");

-- CreateIndex
CREATE INDEX "inbox_threads_lastActivityAt_idx" ON "inbox_threads"("lastActivityAt");

-- CreateTable
CREATE TABLE "inbox_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordChannel" TEXT,
    "direction" TEXT,
    "outcome" TEXT,
    "simulatedChannel" TEXT,
    "chatbotId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" DATETIME NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "editedAt" DATETIME,
    "textPurgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_entries_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "inbox_threads" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "inbox_entries_threadId_occurredAt_idx" ON "inbox_entries"("threadId", "occurredAt");

-- CreateIndex
CREATE INDEX "inbox_entries_textPurgedAt_createdAt_idx" ON "inbox_entries"("textPurgedAt", "createdAt");

-- CreateTable
CREATE TABLE "inbox_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "inbox_tags_nameNormalized_key" ON "inbox_tags"("nameNormalized");

-- CreateTable
CREATE TABLE "inbox_thread_tags" (
    "threadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    PRIMARY KEY ("threadId", "tagId"),
    CONSTRAINT "inbox_thread_tags_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "inbox_threads" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inbox_thread_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "inbox_tags" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "inbox_thread_tags_tagId_idx" ON "inbox_thread_tags"("tagId");

-- CreateTable
CREATE TABLE "customer_merges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "sourceCustomerId" TEXT NOT NULL,
    "targetCustomerId" TEXT NOT NULL,
    "sourceThreadId" TEXT,
    "targetThreadId" TEXT,
    "movedThread" BOOLEAN NOT NULL DEFAULT false,
    "movedLinkIds" TEXT NOT NULL DEFAULT '[]',
    "movedEntryIds" TEXT NOT NULL DEFAULT '[]',
    "addedTagIds" TEXT NOT NULL DEFAULT '[]',
    "sourceThreadPriorStatus" TEXT,
    "mergedById" TEXT,
    "mergedByName" TEXT,
    "mergedAt" DATETIME NOT NULL,
    "revertedAt" DATETIME,
    "revertedById" TEXT,
    "revertedByName" TEXT
);

-- CreateIndex
CREATE INDEX "customer_merges_sourceCustomerId_idx" ON "customer_merges"("sourceCustomerId");

-- CreateIndex
CREATE INDEX "customer_merges_targetCustomerId_mergedAt_idx" ON "customer_merges"("targetCustomerId", "mergedAt");
