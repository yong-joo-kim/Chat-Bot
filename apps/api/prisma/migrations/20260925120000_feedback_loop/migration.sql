-- 피드백 기반 개선 루프(No.44, ADR-0038) — 비파괴 변경만. 기존 행 값 변경 0 · 백필 0 · 테이블 재정의 0.
-- ADD COLUMN x2(상수 기본값/NULL — SQLite는 테이블 재작성 없음) + CREATE TABLE 1.
-- 큐 소스 분리(유니크 인덱스 교체 + lastFeedbackLogId)는 선행 마이그레이션
-- 20260925115000_queue_source_split(커밋 ①)에서 이미 적용했다.
-- ⚠ 원시 부분 유니크 인덱스 4개(test_runs_chatbotId_active_key · deploy_schedules 2 · handoff_sessions_active_key)가
--   있는 테이블을 건드리지 않는다 — RedefineTables가 없으므로 삭제될 경로가 없다(적용 후 sqlite_master로 재확인).
-- 롤백 = message_feedbacks DROP + 2컬럼 제거(SQLite 3.35+ DROP COLUMN). 큐 소스 분리 롤백은
-- 선행 마이그레이션 문서(§3.5) 참고 — NEGATIVE_FEEDBACK 행이 생기면 옛 유일 키로 원복 불가.

-- AlterTable
ALTER TABLE "conversation_logs" ADD COLUMN "feedbackOffered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversation_logs" ADD COLUMN "inputKind" TEXT;

-- CreateTable
CREATE TABLE "message_feedbacks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "conversationLogId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,
    "turnDayBucket" TEXT NOT NULL,
    "turnCreatedAt" DATETIME NOT NULL,
    "channelType" TEXT NOT NULL,
    "isAnswered" BOOLEAN NOT NULL,
    "answeredByRag" BOOLEAN NOT NULL,
    "apiNotice" BOOLEAN NOT NULL,
    "inputKind" TEXT,
    "matchedIntentId" TEXT,
    "matchedFaqId" TEXT,
    "matchedNodeId" TEXT,
    "topicId" TEXT,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT,
    "queueOutcome" TEXT,
    "queueSkipCode" TEXT,
    "queuedAt" DATETIME,
    "queueItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "message_feedbacks_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "message_feedbacks_conversationLogId_key" ON "message_feedbacks"("conversationLogId");
CREATE INDEX "message_feedbacks_chatbotId_turnDayBucket_idx" ON "message_feedbacks"("chatbotId", "turnDayBucket");
CREATE INDEX "message_feedbacks_queueItemId_idx" ON "message_feedbacks"("queueItemId");
