export type BundleSource = { kind: 'DRAFT' } | { kind: 'VERSION'; versionId: string };

/**
 * [신규 No.40] §7.1 — 공개 대화 등 소비자의 소스 결정 단일 지점. `chatbotRow.prodVersionId`는
 * 호출자가 이미 읽은 행의 컬럼이라 추가 조회 0이다.
 */
export function bundleSourceOf(chatbotRow: { prodVersionId: string | null }): BundleSource {
  return chatbotRow.prodVersionId ? { kind: 'VERSION', versionId: chatbotRow.prodVersionId } : { kind: 'DRAFT' };
}
