-- [신규 2026-09-29 No.35] 선제적(Proactive) 메시징 — 전부 CREATE(기존 테이블 재정의 0 · ALTER 0 ·
-- 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/proactive-messaging-설계.md` §3.2 · ADR-0045 근거.

-- CreateTable
CREATE TABLE "chatbot_proactive_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxPerSession" INTEGER NOT NULL DEFAULT 1,
    "minIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "quietAfterUserMessageSec" INTEGER NOT NULL DEFAULT 300,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_proactive_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "proactive_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "buttons" TEXT NOT NULL DEFAULT '[]',
    "devices" TEXT NOT NULL DEFAULT '["DESKTOP"]',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "schedule" TEXT,
    "purposeConfirmedAt" DATETIME NOT NULL,
    "purposeConfirmedById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "proactive_rules_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "proactive_rules_chatbotId_nameNormalized_key" ON "proactive_rules"("chatbotId", "nameNormalized");

-- CreateIndex
CREATE INDEX "proactive_rules_chatbotId_enabled_position_idx" ON "proactive_rules"("chatbotId", "enabled", "position");

-- CreateTable
CREATE TABLE "proactive_daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "shown" INTEGER NOT NULL DEFAULT 0,
    "clicked" INTEGER NOT NULL DEFAULT 0,
    "dismissed" INTEGER NOT NULL DEFAULT 0,
    "optedOut" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "proactive_daily_stats_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "proactive_daily_stats_ruleId_dayBucket_key" ON "proactive_daily_stats"("ruleId", "dayBucket");

-- CreateIndex
CREATE INDEX "proactive_daily_stats_chatbotId_dayBucket_idx" ON "proactive_daily_stats"("chatbotId", "dayBucket");
