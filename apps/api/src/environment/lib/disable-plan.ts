/**
 * [신규 No.40] §5.4 — 끄기 확정의 "초안이 운영과 같은가" 판정. 순수 함수.
 * `KEEP_PROD`인데 초안 해시 ≠ 운영 버전 `contentHash`면 콘솔이 복원을 먼저 수행해야 한다(409
 * `ENV_DRAFT_NOT_RESTORED`). `PROMOTE_DRAFT`는 항상 허용(끄는 순간 초안이 라이브가 된다).
 */
export function decideDisable(input: { mode: 'KEEP_PROD' | 'PROMOTE_DRAFT'; draftContentHash: string; prodContentHash: string }): 'OK' | 'NEED_RESTORE' {
  if (input.mode === 'PROMOTE_DRAFT') return 'OK';
  return input.draftContentHash === input.prodContentHash ? 'OK' : 'NEED_RESTORE';
}
