-- [No.43 pass 8 · RG-21] 인증 벽 가드용 관측 해시 — 그 실행이 이 행에서 관측한 수렴 지문(정규화 본문 sha256 · `R:`/`X:` 접두 해시). 원문 비저장 · 백필 없음(기존 행 null).
-- AlterTable
ALTER TABLE "kb_documents" ADD COLUMN "observedHash" TEXT;
