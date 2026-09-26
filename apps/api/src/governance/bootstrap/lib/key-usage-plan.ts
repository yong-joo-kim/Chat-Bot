/**
 * ★ 키 사용 행 검사(No.45 §5.3) — 판정만 순수. 실제 접두 검색(`LIKE 'enc:v1:%'`)은
 * `governance-bootstrap.service.ts`가 수행하고, 이 함수는 "미지 키가 있으면 기동 실패" 판정을 맡는다.
 */
export interface KeyUsageCheckResult {
  ok: boolean;
  unknownKeyId?: string;
  affectedRows?: number;
  field?: string;
}

export function judgeKeyUsage(field: string, unknownKeyId: string | null, affectedRows: number): KeyUsageCheckResult {
  if (!unknownKeyId) return { ok: true };
  return { ok: false, field, unknownKeyId, affectedRows };
}
