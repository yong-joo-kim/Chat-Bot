-- 토픽 시스템(No.22, ADR-0037) — 비파괴 변경만. 기존 행 값 변경 0 · 백필 0(모든 자산 topicId=null=공통).
-- CREATE TABLE topics(1) + conversation_logs ADD COLUMN topicId(FK·인덱스 없음 — 테이블 재작성 없음)
-- + 자산 6테이블 중 topics를 참조하는 6개(intents/keywords/homonym_dictionaries/dialog_nodes/
-- context_variables/faq_entries)는 SQLite가 FK 컬럼 추가를 RedefineTables(재정의)로 처리한다.
-- ⚠ 검토 결과: 6테이블의 기존 컬럼·유니크·인덱스·FK(dialog_nodes.contextVariableId 포함)가 전부
-- 재생성됨을 확인했다. test_runs/deploy_schedules/handoff_sessions는 이 마이그레이션이 건드리는
-- 테이블 목록에 없다 — RedefineTables 대상이 아니므로 그 테이블들의 원시 부분 유니크 인덱스는
-- 이 마이그레이션으로 삭제되지 않는다(적용 후 sqlite_master로 재확인 완료 — topic-system-설계.md §3.2).
-- 롤백 = topics DROP + conversation_logs.topicId 컬럼 제거 + 자산 6테이블 재정의(topicId 제거).

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "topicId" TEXT;

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "topics_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "topicId" TEXT,
    CONSTRAINT "context_variables_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "context_variables_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_context_variables" ("cancelKeywords", "chatbotId", "completionMessage", "createdAt", "description", "id", "name", "nameNormalized", "sessionTimeoutMinutes", "slots", "updatedAt") SELECT "cancelKeywords", "chatbotId", "completionMessage", "createdAt", "description", "id", "name", "nameNormalized", "sessionTimeoutMinutes", "slots", "updatedAt" FROM "context_variables";
DROP TABLE "context_variables";
ALTER TABLE "new_context_variables" RENAME TO "context_variables";
CREATE INDEX "context_variables_chatbotId_updatedAt_idx" ON "context_variables"("chatbotId", "updatedAt");
CREATE INDEX "context_variables_topicId_idx" ON "context_variables"("topicId");
CREATE UNIQUE INDEX "context_variables_chatbotId_nameNormalized_key" ON "context_variables"("chatbotId", "nameNormalized");
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
    "topicId" TEXT,
    CONSTRAINT "dialog_nodes_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "dialog_nodes_contextVariableId_fkey" FOREIGN KEY ("contextVariableId") REFERENCES "context_variables" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "dialog_nodes_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_dialog_nodes" ("chatbotId", "contextVariableId", "createdAt", "description", "enabled", "id", "matchMode", "name", "nameNormalized", "nodeType", "outputs", "priority", "updatedAt") SELECT "chatbotId", "contextVariableId", "createdAt", "description", "enabled", "id", "matchMode", "name", "nameNormalized", "nodeType", "outputs", "priority", "updatedAt" FROM "dialog_nodes";
DROP TABLE "dialog_nodes";
ALTER TABLE "new_dialog_nodes" RENAME TO "dialog_nodes";
CREATE INDEX "dialog_nodes_chatbotId_priority_idx" ON "dialog_nodes"("chatbotId", "priority");
CREATE INDEX "dialog_nodes_chatbotId_nodeType_idx" ON "dialog_nodes"("chatbotId", "nodeType");
CREATE INDEX "dialog_nodes_topicId_idx" ON "dialog_nodes"("topicId");
CREATE UNIQUE INDEX "dialog_nodes_chatbotId_nameNormalized_key" ON "dialog_nodes"("chatbotId", "nameNormalized");
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
    "topicId" TEXT,
    CONSTRAINT "faq_entries_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "faq_entries_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_faq_entries" ("altQuestions", "answer", "category", "chatbotId", "createdAt", "enabled", "id", "question", "questionNormalized", "updatedAt") SELECT "altQuestions", "answer", "category", "chatbotId", "createdAt", "enabled", "id", "question", "questionNormalized", "updatedAt" FROM "faq_entries";
DROP TABLE "faq_entries";
ALTER TABLE "new_faq_entries" RENAME TO "faq_entries";
CREATE INDEX "faq_entries_chatbotId_category_idx" ON "faq_entries"("chatbotId", "category");
CREATE INDEX "faq_entries_chatbotId_updatedAt_idx" ON "faq_entries"("chatbotId", "updatedAt");
CREATE INDEX "faq_entries_topicId_idx" ON "faq_entries"("topicId");
CREATE UNIQUE INDEX "faq_entries_chatbotId_questionNormalized_key" ON "faq_entries"("chatbotId", "questionNormalized");
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
    "topicId" TEXT,
    CONSTRAINT "homonym_dictionaries_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "homonym_dictionaries_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_homonym_dictionaries" ("chatbotId", "clarifyPrompt", "createdAt", "defaultMeaningIndex", "description", "id", "meanings", "policy", "updatedAt", "word", "wordNormalized") SELECT "chatbotId", "clarifyPrompt", "createdAt", "defaultMeaningIndex", "description", "id", "meanings", "policy", "updatedAt", "word", "wordNormalized" FROM "homonym_dictionaries";
DROP TABLE "homonym_dictionaries";
ALTER TABLE "new_homonym_dictionaries" RENAME TO "homonym_dictionaries";
CREATE INDEX "homonym_dictionaries_chatbotId_updatedAt_idx" ON "homonym_dictionaries"("chatbotId", "updatedAt");
CREATE INDEX "homonym_dictionaries_topicId_idx" ON "homonym_dictionaries"("topicId");
CREATE UNIQUE INDEX "homonym_dictionaries_chatbotId_wordNormalized_key" ON "homonym_dictionaries"("chatbotId", "wordNormalized");
CREATE TABLE "new_intents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "examples" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "topicId" TEXT,
    CONSTRAINT "intents_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "intents_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_intents" ("chatbotId", "createdAt", "description", "examples", "id", "name", "nameNormalized", "updatedAt") SELECT "chatbotId", "createdAt", "description", "examples", "id", "name", "nameNormalized", "updatedAt" FROM "intents";
DROP TABLE "intents";
ALTER TABLE "new_intents" RENAME TO "intents";
CREATE INDEX "intents_chatbotId_updatedAt_idx" ON "intents"("chatbotId", "updatedAt");
CREATE INDEX "intents_topicId_idx" ON "intents"("topicId");
CREATE UNIQUE INDEX "intents_chatbotId_nameNormalized_key" ON "intents"("chatbotId", "nameNormalized");
CREATE TABLE "new_keywords" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "synonyms" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "topicId" TEXT,
    CONSTRAINT "keywords_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "keywords_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_keywords" ("chatbotId", "createdAt", "description", "id", "name", "nameNormalized", "synonyms", "updatedAt") SELECT "chatbotId", "createdAt", "description", "id", "name", "nameNormalized", "synonyms", "updatedAt" FROM "keywords";
DROP TABLE "keywords";
ALTER TABLE "new_keywords" RENAME TO "keywords";
CREATE INDEX "keywords_chatbotId_updatedAt_idx" ON "keywords"("chatbotId", "updatedAt");
CREATE INDEX "keywords_topicId_idx" ON "keywords"("topicId");
CREATE UNIQUE INDEX "keywords_chatbotId_nameNormalized_key" ON "keywords"("chatbotId", "nameNormalized");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "topics_chatbotId_sortOrder_idx" ON "topics"("chatbotId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "topics_chatbotId_nameNormalized_key" ON "topics"("chatbotId", "nameNormalized");

