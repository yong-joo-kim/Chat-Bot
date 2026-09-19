-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "contextVariableId" TEXT,
    "outputs" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "dialog_nodes_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "dialog_nodes_contextVariableId_fkey" FOREIGN KEY ("contextVariableId") REFERENCES "context_variables" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_dialog_nodes" ("chatbotId", "contextVariableId", "createdAt", "description", "enabled", "id", "matchMode", "name", "nameNormalized", "nodeType", "outputs", "priority", "updatedAt") SELECT "chatbotId", "contextVariableId", "createdAt", "description", "enabled", "id", "matchMode", "name", "nameNormalized", "nodeType", "outputs", "priority", "updatedAt" FROM "dialog_nodes";
DROP TABLE "dialog_nodes";
ALTER TABLE "new_dialog_nodes" RENAME TO "dialog_nodes";
CREATE INDEX "dialog_nodes_chatbotId_priority_idx" ON "dialog_nodes"("chatbotId", "priority");
CREATE INDEX "dialog_nodes_chatbotId_nodeType_idx" ON "dialog_nodes"("chatbotId", "nodeType");
CREATE UNIQUE INDEX "dialog_nodes_chatbotId_nameNormalized_key" ON "dialog_nodes"("chatbotId", "nameNormalized");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "context_variables_chatbotId_nameNormalized_key" ON "context_variables"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "faq_entries_chatbotId_questionNormalized_key" ON "faq_entries"("chatbotId", "questionNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "homonym_dictionaries_chatbotId_wordNormalized_key" ON "homonym_dictionaries"("chatbotId", "wordNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "intents_chatbotId_nameNormalized_key" ON "intents"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_chatbotId_nameNormalized_key" ON "keywords"("chatbotId", "nameNormalized");

