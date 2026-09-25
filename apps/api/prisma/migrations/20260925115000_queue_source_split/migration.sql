-- 학습현황 큐 소스 분리 준비(No.44 커밋 ① — ADR-0038 §4·§10.1). 비파괴 변경만.
-- 기존 행 값 변경 0 · 백필 0 · 테이블 재정의 0. 이 변경 단독으로 동작이 바뀌지 않는다
-- (도입 시점 모든 unanswered_questions 행은 source='UNANSWERED'이므로 새 키는 기존 키의 상위 집합).

-- ① 사전 확인(배포 절차 — 결과를 배포 기록에 남긴다)
--   SELECT "source", COUNT(*) FROM "unanswered_questions" GROUP BY "source";   -- 기대: UNANSWERED 1행뿐
--   (새 키 (chatbotId, source, questionNormalized)는 기존 키 (chatbotId, questionNormalized)의 상위 집합이라 중복이 원리상 불가능하다)

-- AlterTable
ALTER TABLE "unanswered_questions" ADD COLUMN "lastFeedbackLogId" TEXT;

-- 유일 키 교체(소스 분리)
DROP INDEX "unanswered_questions_chatbotId_questionNormalized_key";
CREATE UNIQUE INDEX "unanswered_questions_chatbotId_source_questionNormalized_key"
  ON "unanswered_questions"("chatbotId", "source", "questionNormalized");
