-- No.27 설문관리(ADR-0035) — 비파괴 변경만(CREATE TABLE ×3 + ALTER TABLE ADD COLUMN ×3).
-- 기존 행·컬럼 변경 0 · 백필 0. 롤백 = 세 테이블 DROP + 세 컬럼 제거.
-- v1 SURVEY 데이터는 마이그레이션하지 않는다(P-15 — 자동 연결·변환 없음).

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "activeFrom" DATETIME,
    "activeTo" DATETIME,
    "introMessage" TEXT,
    "completionMessage" TEXT NOT NULL DEFAULT '설문에 참여해 주셔서 감사합니다.',
    "cancelKeywords" TEXT NOT NULL DEFAULT '["그만","취소","설문 종료"]',
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "questions" TEXT NOT NULL DEFAULT '[]',
    "structureVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "surveys_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "surveys_chatbotId_nameNormalized_key" ON "surveys"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE INDEX "surveys_chatbotId_updatedAt_idx" ON "surveys"("chatbotId", "updatedAt");

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "structureVersion" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXPOSED',
    "endReason" TEXT,
    "started" BOOLEAN NOT NULL DEFAULT false,
    "lastQuestionIndex" INTEGER NOT NULL DEFAULT -1,
    "lastInteractedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "endedAt" DATETIME,
    "missingRequiredCount" INTEGER NOT NULL DEFAULT 0,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "exposedNodeId" TEXT,
    "conversationLogId" TEXT,
    "dayBucket" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "survey_responses_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_chatbotId_sessionId_surveyId_startedAt_key" ON "survey_responses"("chatbotId", "sessionId", "surveyId", "startedAt");

-- CreateIndex
CREATE INDEX "survey_responses_surveyId_dayBucket_idx" ON "survey_responses"("surveyId", "dayBucket");

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "isHead" BOOLEAN NOT NULL,
    "choiceKey" TEXT NOT NULL DEFAULT '',
    "numericValue" INTEGER,
    "textValue" TEXT,
    "dayBucket" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" DATETIME NOT NULL,
    CONSTRAINT "survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_responses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "survey_answers_responseId_questionKey_choiceKey_key" ON "survey_answers"("responseId", "questionKey", "choiceKey");

-- CreateIndex
CREATE INDEX "survey_answers_surveyId_questionKey_dayBucket_idx" ON "survey_answers"("surveyId", "questionKey", "dayBucket");

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "surveyTurn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "test_run_results" ADD COLUMN "surveyPreviewA" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "test_run_results" ADD COLUMN "surveyPreviewB" BOOLEAN NOT NULL DEFAULT false;
