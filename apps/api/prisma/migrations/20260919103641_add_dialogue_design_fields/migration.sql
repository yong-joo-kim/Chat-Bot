-- CreateTable
CREATE TABLE "dialog_node_intents" (
    "nodeId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,

    PRIMARY KEY ("nodeId", "intentId"),
    CONSTRAINT "dialog_node_intents_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dialog_nodes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "dialog_node_intents_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "intents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dialog_node_keywords" (
    "nodeId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,

    PRIMARY KEY ("nodeId", "keywordId"),
    CONSTRAINT "dialog_node_keywords_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dialog_nodes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "dialog_node_keywords_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "keywords" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_context_variables" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "slots" TEXT NOT NULL,
    "completionMessage" TEXT,
    "cancelKeywords" TEXT NOT NULL DEFAULT '["취소","그만","처음으로"]',
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "context_variables_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_context_variables" ("chatbotId", "createdAt", "id", "name", "slots") SELECT "chatbotId", "createdAt", "id", "name", "slots" FROM "context_variables";
DROP TABLE "context_variables";
ALTER TABLE "new_context_variables" RENAME TO "context_variables";
CREATE INDEX "context_variables_chatbotId_updatedAt_idx" ON "context_variables"("chatbotId", "updatedAt");
CREATE TABLE "new_dialog_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "nodeType" TEXT NOT NULL DEFAULT 'NORMAL',
    "matchMode" TEXT NOT NULL DEFAULT 'ANY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "intentIds" TEXT NOT NULL DEFAULT '[]',
    "keywordIds" TEXT NOT NULL DEFAULT '[]',
    "contextVariableId" TEXT,
    "outputs" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "dialog_nodes_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_dialog_nodes" ("chatbotId", "contextVariableId", "createdAt", "id", "intentIds", "keywordIds", "name", "outputs", "updatedAt") SELECT "chatbotId", "contextVariableId", "createdAt", "id", "intentIds", "keywordIds", "name", "outputs", "updatedAt" FROM "dialog_nodes";
DROP TABLE "dialog_nodes";
ALTER TABLE "new_dialog_nodes" RENAME TO "dialog_nodes";
CREATE INDEX "dialog_nodes_chatbotId_priority_idx" ON "dialog_nodes"("chatbotId", "priority");
CREATE INDEX "dialog_nodes_chatbotId_nodeType_idx" ON "dialog_nodes"("chatbotId", "nodeType");
CREATE TABLE "new_faq_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionNormalized" TEXT NOT NULL DEFAULT '',
    "answer" TEXT NOT NULL,
    "altQuestions" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "faq_entries_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_faq_entries" ("answer", "category", "chatbotId", "createdAt", "id", "question", "updatedAt") SELECT "answer", "category", "chatbotId", "createdAt", "id", "question", "updatedAt" FROM "faq_entries";
DROP TABLE "faq_entries";
ALTER TABLE "new_faq_entries" RENAME TO "faq_entries";
CREATE INDEX "faq_entries_chatbotId_category_idx" ON "faq_entries"("chatbotId", "category");
CREATE INDEX "faq_entries_chatbotId_updatedAt_idx" ON "faq_entries"("chatbotId", "updatedAt");
CREATE TABLE "new_homonym_dictionaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "wordNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "meanings" TEXT NOT NULL,
    "policy" TEXT NOT NULL DEFAULT 'ASK',
    "clarifyPrompt" TEXT,
    "defaultMeaningIndex" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "homonym_dictionaries_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_homonym_dictionaries" ("chatbotId", "createdAt", "id", "meanings", "word") SELECT "chatbotId", "createdAt", "id", "meanings", "word" FROM "homonym_dictionaries";
DROP TABLE "homonym_dictionaries";
ALTER TABLE "new_homonym_dictionaries" RENAME TO "homonym_dictionaries";
CREATE INDEX "homonym_dictionaries_chatbotId_updatedAt_idx" ON "homonym_dictionaries"("chatbotId", "updatedAt");
CREATE TABLE "new_intents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "examples" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "intents_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_intents" ("chatbotId", "createdAt", "examples", "id", "name", "updatedAt") SELECT "chatbotId", "createdAt", "examples", "id", "name", "updatedAt" FROM "intents";
DROP TABLE "intents";
ALTER TABLE "new_intents" RENAME TO "intents";
CREATE INDEX "intents_chatbotId_updatedAt_idx" ON "intents"("chatbotId", "updatedAt");
CREATE TABLE "new_keywords" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "synonyms" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "keywords_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_keywords" ("chatbotId", "createdAt", "id", "name", "synonyms", "updatedAt") SELECT "chatbotId", "createdAt", "id", "name", "synonyms", "updatedAt" FROM "keywords";
DROP TABLE "keywords";
ALTER TABLE "new_keywords" RENAME TO "keywords";
CREATE INDEX "keywords_chatbotId_updatedAt_idx" ON "keywords"("chatbotId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "dialog_node_intents_intentId_idx" ON "dialog_node_intents"("intentId");

-- CreateIndex
CREATE INDEX "dialog_node_keywords_keywordId_idx" ON "dialog_node_keywords"("keywordId");
