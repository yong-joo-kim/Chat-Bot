import { z } from 'zod';

/**
 * 대량 업로드(엑셀/CSV) 2단계 계약 — 의도·키워드·FAQ 3개 도메인이 공유(FR-6-19~30, FR-9-9).
 * `docs/02-spec/dialogue-design-설계.md` §4.5, ADR-0007 근거.
 */

/** `TEST_CASE`는 검증/품질 고도화(No.19) 그룹이 추가한 3번째 소비자다(ADR-0007 각주 — 새 파서 0건). */
export const ImportResourceType = z.enum(['INTENT', 'KEYWORD', 'FAQ', 'TEST_CASE']);
export type ImportResourceType = z.infer<typeof ImportResourceType>;

export const ImportMergePolicy = z.enum(['MERGE', 'REPLACE', 'SKIP']);
export type ImportMergePolicy = z.infer<typeof ImportMergePolicy>;

export const ImportErrorPolicy = z.enum(['SKIP_INVALID', 'ABORT_ON_ERROR']);
export type ImportErrorPolicy = z.infer<typeof ImportErrorPolicy>;

export const ImportRowErrorCode = z.enum([
  'EMPTY_NAME',
  'EMPTY_VALUE',
  'TOO_LONG',
  'INVALID_CHAR',
  'DUPLICATE_IN_FILE',
  'SYNONYM_CONFLICT',
  'INVALID_CATEGORY',
  // 검증/품질 고도화(No.19) 그룹 추가 — TC 업로드의 기대대상명 → ID 해석 실패(FR-V1-13).
  'TARGET_NOT_FOUND',
  'AMBIGUOUS_TARGET',
]);
export type ImportRowErrorCode = z.infer<typeof ImportRowErrorCode>;

export const ImportRowErrorSchema = z.object({
  row: z.number().int().min(1),
  column: z.string(),
  value: z.string().max(200),
  code: ImportRowErrorCode,
  message: z.string(),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const ImportConflictSchema = z.object({
  value: z.string(),
  ownerId: z.string().uuid(),
  ownerName: z.string(),
});
export type ImportConflict = z.infer<typeof ImportConflictSchema>;

export const ImportValidateResultSchema = z.object({
  importToken: z.string(),
  expiresAt: z.coerce.date(),
  resourceType: ImportResourceType,
  totalRows: z.number().int().nonnegative(),
  newItems: z.number().int().nonnegative(),
  updatedItems: z.number().int().nonnegative(),
  newValues: z.number().int().nonnegative(),
  duplicatedRows: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
  conflicts: z.array(ImportConflictSchema),
});
export type ImportValidateResult = z.infer<typeof ImportValidateResultSchema>;

export const ImportCommitRequestSchema = z.object({
  importToken: z.string(),
  mergePolicy: ImportMergePolicy.default('MERGE'),
  errorPolicy: ImportErrorPolicy.default('SKIP_INVALID'),
});
export type ImportCommitRequestDto = z.infer<typeof ImportCommitRequestSchema>;

export const ImportCommitResultSchema = z.object({
  createdItems: z.number().int().nonnegative(),
  updatedItems: z.number().int().nonnegative(),
  createdValues: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
});
export type ImportCommitResult = z.infer<typeof ImportCommitResultSchema>;

/** 업로드 상한/토큰 TTL(FR-6-20, FR-6-21) — 신규 환경변수를 만들지 않고 이 상수로 고정한다. */
export const IMPORT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  tokenTtlMs: 10 * 60_000,
} as const;

/**
 * CSV 수식 인젝션 방어(FR-6-29, NFR-S7). `=`, `+`, `-`, `@`로 시작하는 셀 값 앞에 `'`를 붙인다.
 * 서버 export/템플릿 생성과 프런트 오류 CSV 생성이 공유한다(DD-16).
 */
export function escapeCsvCell(value: string): string {
  const needsEscape = /^[=+\-@]/.test(value);
  const escaped = needsEscape ? `'${value}` : value;
  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}
