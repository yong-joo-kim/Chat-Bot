/**
 * [N40-3] 환경 모드 끄기 "초안을 운영으로"의 차단 게이트 판정(n40-follow-up-설계.md §3). 순수 함수.
 * 게이트를 평가하지 않는다 — 초안은 버전 id가 없어 TC 게이트 대상이 될 수 없으므로,
 * 차단 모드에서 시험하지 않은 내용이 라이브가 되는 경우만 막는다.
 * 규칙: mode = PROMOTE_DRAFT ∧ gateMode = BLOCK ∧ 초안 contentHash ≠ 운영 contentHash → `GATE_BLOCKED`, 그 외 `OK`.
 */
export function decidePromoteDraftGate(input: {
  mode: 'KEEP_PROD' | 'PROMOTE_DRAFT';
  gateMode: 'WARN' | 'BLOCK';
  draftContentHash: string;
  prodContentHash: string;
}): 'OK' | 'GATE_BLOCKED' {
  if (input.mode !== 'PROMOTE_DRAFT') return 'OK';
  if (input.gateMode !== 'BLOCK') return 'OK';
  return input.draftContentHash === input.prodContentHash ? 'OK' : 'GATE_BLOCKED';
}
