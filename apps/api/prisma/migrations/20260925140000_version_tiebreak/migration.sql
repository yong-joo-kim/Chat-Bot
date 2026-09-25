-- No.40 환경분리 커밋 ① (ADR-0039 §3). 비파괴: ADD COLUMN 1(NULL). 백필 0.
ALTER TABLE "chatbot_versions" ADD COLUMN "tiebreakHash" TEXT;
