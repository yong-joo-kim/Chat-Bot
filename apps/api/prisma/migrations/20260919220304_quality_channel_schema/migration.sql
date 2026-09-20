/*
  Warnings:

  - Added the required column `updatedAt` to the `channels` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "matchedFaqId" TEXT;
ALTER TABLE "conversation_logs" ADD COLUMN "matchedNodeId" TEXT;

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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channels_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- 기존 행은 마이그레이션 시점(now())으로 updatedAt을 백필한다 — 정확한 이력이 아님을 감수한다(운영 데이터 0건이라 실질 영향 없음, 설계서 §3.2).
INSERT INTO "new_channels" ("chatbotId", "config", "createdAt", "enabled", "id", "type", "updatedAt") SELECT "chatbotId", "config", "createdAt", "enabled", "id", "type", CURRENT_TIMESTAMP FROM "channels";
DROP TABLE "channels";
ALTER TABLE "new_channels" RENAME TO "channels";
CREATE UNIQUE INDEX "channels_chatbotId_type_key" ON "channels"("chatbotId", "type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
