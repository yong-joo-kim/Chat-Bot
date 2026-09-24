-- 하이브리드 CS(No.24, ADR-0036) — 비파괴 변경만. 기존 행·컬럼 변경 0 · 백필 0.
-- CREATE TABLE x4 + conversation_logs ADD COLUMN x2(상수 기본값 — 테이블 재작성 없음) + 인덱스
-- + 원시 DDL 1줄(부분 유니크). 롤백 = 4테이블 DROP + 2컬럼 제거 + 인덱스 DROP.
-- ⚠ `prisma migrate dev` diff가 conversation_logs를 RedefineTables(테이블 재작성)로 제안했으나,
-- 설계서 §3.2에 따라 단순 ADD COLUMN으로 수기 작성했다(비파괴 원칙 · 대형 테이블 재작성 비용 회피).

-- CreateTable
CREATE TABLE "chatbot_handoff_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "draining" BOOLEAN NOT NULL DEFAULT false,
    "cautionThreshold" INTEGER NOT NULL DEFAULT 2,
    "warningThreshold" INTEGER NOT NULL DEFAULT 3,
    "activeWindowMinutes" INTEGER NOT NULL DEFAULT 10,
    "userIdleMinutes" INTEGER NOT NULL DEFAULT 10,
    "agentNoReplyMinutes" INTEGER NOT NULL DEFAULT 5,
    "connectNotice" TEXT NOT NULL DEFAULT '상담원이 연결되었어요. 잠시만 기다려 주세요.',
    "endNotice" TEXT NOT NULL DEFAULT '상담이 종료되었어요. 이제 챗봇이 도와드릴게요.',
    "failNotice" TEXT NOT NULL DEFAULT '지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.',
    "endButtonLabel" TEXT,
    "endButtonNodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_handoff_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handoff_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionRef" TEXT NOT NULL,
    "channelType" TEXT NOT NULL DEFAULT 'WEB',
    "status" TEXT NOT NULL DEFAULT 'CONNECTING',
    "endReason" TEXT,
    "clientMode" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "assignedUserName" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "startedByName" TEXT NOT NULL,
    "alertLevelAtStart" TEXT NOT NULL,
    "consecutiveUnansweredAtStart" INTEGER NOT NULL,
    "tokenHash" TEXT,
    "tokenIssuedAt" DATETIME,
    "unverifiedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "legacyDeliveredSeq" INTEGER NOT NULL DEFAULT 0,
    "userMessageCount" INTEGER NOT NULL DEFAULT 0,
    "agentMessageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "connectedAt" DATETIME,
    "firstAgentReplyAt" DATETIME,
    "lastUserMessageAt" DATETIME,
    "lastAgentMessageAt" DATETIME,
    "endedAt" DATETIME,
    "endedById" TEXT,
    "endedByName" TEXT,
    "dayBucket" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "handoff_sessions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "handoff_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handoffSessionId" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sender" TEXT NOT NULL,
    "systemKind" TEXT,
    "senderUserId" TEXT,
    "senderUserName" TEXT,
    "text" TEXT NOT NULL,
    "rawText" TEXT,
    "rawExpiresAt" DATETIME,
    "conversationLogId" TEXT,
    "action" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "handoff_messages_handoffSessionId_fkey" FOREIGN KEY ("handoffSessionId") REFERENCES "handoff_sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleNormalized" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "shortcut" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "canned_responses_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable(비파괴 — 상수 기본값 ADD COLUMN, SQLite 테이블 재작성 없음)
ALTER TABLE "conversation_logs" ADD COLUMN "handoffTurn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversation_logs" ADD COLUMN "apiNotice" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "conversation_logs_chatbotId_sessionId_createdAt_idx" ON "conversation_logs"("chatbotId", "sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_sessions_tokenHash_key" ON "handoff_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "handoff_sessions_chatbotId_sessionId_startedAt_idx" ON "handoff_sessions"("chatbotId", "sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "handoff_sessions_chatbotId_sessionRef_idx" ON "handoff_sessions"("chatbotId", "sessionRef");

-- CreateIndex
CREATE INDEX "handoff_sessions_chatbotId_status_idx" ON "handoff_sessions"("chatbotId", "status");

-- CreateIndex
CREATE INDEX "handoff_sessions_chatbotId_dayBucket_idx" ON "handoff_sessions"("chatbotId", "dayBucket");

-- CreateIndex
CREATE INDEX "handoff_sessions_status_startedAt_idx" ON "handoff_sessions"("status", "startedAt");

-- CreateIndex
CREATE INDEX "handoff_sessions_assignedUserId_status_idx" ON "handoff_sessions"("assignedUserId", "status");

-- CreateIndex(부분 유니크 — 원시 DDL. Prisma 스키마에는 표현되지 않는다. 세션당 활성 상담 최대 1건(P-8).
-- test_runs_chatbotId_active_key · deploy_schedules 부분 유니크 2개 선례와 같은 형식.)
CREATE UNIQUE INDEX "handoff_sessions_active_key" ON "handoff_sessions"("chatbotId", "sessionId") WHERE "status" IN ('CONNECTING', 'CONNECTED');

-- CreateIndex
CREATE UNIQUE INDEX "handoff_messages_handoffSessionId_seq_key" ON "handoff_messages"("handoffSessionId", "seq");

-- CreateIndex
CREATE INDEX "handoff_messages_rawExpiresAt_idx" ON "handoff_messages"("rawExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "canned_responses_chatbotId_titleNormalized_key" ON "canned_responses"("chatbotId", "titleNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "canned_responses_chatbotId_shortcut_key" ON "canned_responses"("chatbotId", "shortcut");

-- CreateIndex
CREATE INDEX "canned_responses_chatbotId_sortOrder_idx" ON "canned_responses"("chatbotId", "sortOrder");
