-- [신규 2026-10-01 No.32] 음성 AI — CREATE TABLE 2 + CREATE UNIQUE INDEX 1만(기존 테이블 재정의 0 · ALTER 0 ·
-- DROP 0 · 원시 부분 유니크 4종 보존 · 백필 0). `docs/02-spec/voice-ai-설계.md` §3.2 · ADR-0052 근거.

-- CreateTable
CREATE TABLE "chatbot_voice_settings" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "inputEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ttsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReadToggleVisible" BOOLEAN NOT NULL DEFAULT true,
    "rateMultiplier" REAL NOT NULL DEFAULT 1.0,
    "defaultTone" TEXT NOT NULL DEFAULT 'CALM',
    "toneByKind" TEXT NOT NULL DEFAULT '{}',
    "nodeTones" TEXT NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_voice_settings_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "speech_daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "empty" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "busy" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "speech_daily_stats_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "speech_daily_stats_chatbotId_dayBucket_key" ON "speech_daily_stats"("chatbotId", "dayBucket");
