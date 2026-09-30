import type { GateEvaluation, ProdSwitchPreviewResponse } from '@chat-bot/shared-types';

/**
 * [N40-1] 롤백의 게이트 BLOCK 완화(FR-EN4-4) 적용 여부. 서버가 `directRollback=false`(직전 운영 버전이 아닌 이력 버전)로 알려 주면
 * 일반 전환과 같은 게이트가 적용되므로 완화하지 않는다. 키가 없는 응답(이전 서버)은 기존 동작(롤백이면 완화)을 유지한다.
 */
export function isRollbackGateRelaxed(isRollback: boolean, directRollback: ProdSwitchPreviewResponse['directRollback']): boolean {
  return isRollback && directRollback !== false;
}

/** 완화 대상이면 차단 사유 목록에서 `GATE_BLOCKED`를 뺀다(경고로만 취급). */
export function effectiveSwitchBlockers(blockers: ProdSwitchPreviewResponse['blockers'], relaxed: boolean): ProdSwitchPreviewResponse['blockers'] {
  return relaxed ? blockers.filter((b) => b !== 'GATE_BLOCKED') : blockers;
}

/** 완화 대상이면 배지의 BLOCK을 WARN으로 표시한다. */
export function displayGate(gate: GateEvaluation, relaxed: boolean): GateEvaluation {
  return relaxed && gate.verdict === 'BLOCK' ? { ...gate, verdict: 'WARN' } : gate;
}
