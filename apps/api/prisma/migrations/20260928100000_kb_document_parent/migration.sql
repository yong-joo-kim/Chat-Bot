-- [No.43 pass 6 · H-2] 링크 발견 부모 문서 id — 304·오류·차단으로 링크를 확인하지 못한 부모의 자식들을 이어 방문하기 위한 포인터(FK 없음).
-- AlterTable
ALTER TABLE "kb_documents" ADD COLUMN "discoveredFromId" TEXT;

-- CreateIndex
CREATE INDEX "kb_documents_sourceId_discoveredFromId_idx" ON "kb_documents"("sourceId", "discoveredFromId");
