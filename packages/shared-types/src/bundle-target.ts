import { z } from 'zod';

/**
 * 환경 분리(No.40) — 대화 자산 소스 판별 유니온(ADR-0039 §7). `conversation.ts`(시뮬레이터)·
 * `validation.ts`(TC 실행)·`environment.ts`가 공유한다. zod만 의존(순환·위젯 반입 없음).
 */
export const BundleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DRAFT') }),
  z.object({ kind: z.literal('STAGING') }),
  z.object({ kind: z.literal('PROD') }),
  z.object({ kind: z.literal('VERSION'), versionId: z.string().uuid() }),
]);
export type BundleTarget = z.infer<typeof BundleTargetSchema>;

/** 응답 에코(비초안 대상일 때만 싣는다). */
export const ResolvedBundleTargetSchema = z.object({
  kind: z.enum(['STAGING', 'PROD', 'VERSION']),
  versionId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  legacyTiebreak: z.boolean(),
  semanticMissing: z.number().int().nonnegative(),
});
export type ResolvedBundleTarget = z.infer<typeof ResolvedBundleTargetSchema>;
