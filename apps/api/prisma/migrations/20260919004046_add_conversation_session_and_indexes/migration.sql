-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "chatbots_groupId_status_idx" ON "chatbots"("groupId", "status");

-- CreateIndex
CREATE INDEX "chatbots_updatedAt_idx" ON "chatbots"("updatedAt");

-- CreateIndex
CREATE INDEX "conversation_logs_chatbotId_createdAt_idx" ON "conversation_logs"("chatbotId", "createdAt");
