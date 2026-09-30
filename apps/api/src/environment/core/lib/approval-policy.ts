/**
 * [신규 No.36] 운영 전환 2인 승인 판정 순수 함수(ai-guardrails-설계.md §10.8, ADR-0048). DB·Nest 무의존.
 * 정책은 `ChatbotEnvironment`의 2컬럼(`approvalRequired`·`approvalTtlHours`)이다.
 */

export interface ApprovalPolicy {
  required: boolean;
  ttlHours: number;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = { required: false, ttlHours: 24 };

/**
 * 이 전환이 "다른 관리자의 승인"을 요구하는가.
 * - 정책 꺼짐 → 불필요(현행과 동일).
 * - `SWITCH` → 필요.
 * - `ROLLBACK`: 대상이 `pickRollbackTarget()` 결과(= 대상 생략 시의 기본 대상 = 직전 운영 버전)이면 예외(불필요 — 즉시·표식·감사),
 *   그 밖의 운영 이력 버전이면 필요(R-8 · C-9 — 롤백 API가 임의 이력 버전을 받고 게이트 BLOCK을 면제하므로 1인 우회로를 막는다).
 */
export function requiresApproval(policy: ApprovalPolicy, kind: 'SWITCH' | 'ROLLBACK', isDirectRollback: boolean): boolean {
  if (!policy.required) return false;
  if (kind === 'ROLLBACK' && isDirectRollback) return false;
  return true;
}
