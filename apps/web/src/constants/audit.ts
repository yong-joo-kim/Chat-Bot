/**
 * 이력 기록 소급 시작일(security-audit-ui-spec.md §10 인계 메모 3).
 * ⚠ 백엔드가 `AuditLogListResponseSchema`에 이 값을 부가 필드로 내려주는 방식이 아직 확정되지
 * 않아, 실제 마이그레이션 시각(`apps/api/prisma/migrations/20260921084142_security_audit_schema`)
 * 을 임시 상수로 반영한다. 배포일이 확정되면 서버가 이 값을 응답 필드로 내려주도록 바꾸고
 * 이 상수는 제거해야 한다(code-reviewer/backend-implementer 후속 확인 필요).
 */
export const AUDIT_RETENTION_START_DATE = '2026-09-21';
