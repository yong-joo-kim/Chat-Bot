import { z } from 'zod';

/**
 * [신규 No.46] 챗봇별 리치 메시지(캐러셀) 이미지·링크 허용 도메인 목록 계약
 * (`channel-rich-messages-설계.md` §4.8 · §9.3 — `GET·PUT /chatbots/:chatbotId/rich-url-policy`).
 */
export const RICH_URL_POLICY_LIMITS = { hostsMax: 50, hostMax: 253 } as const;

export const RichUrlHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(RICH_URL_POLICY_LIMITS.hostMax)
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    '호스트 이름만 입력해 주세요(예: img.example.com — https://·경로·포트 제외, 한글 도메인은 퓨니코드로).',
  );

export const RichUrlHostRuleSchema = z.object({ host: RichUrlHostSchema, includeSubdomains: z.boolean() }).strict();
export type RichUrlHostRule = z.infer<typeof RichUrlHostRuleSchema>;

export const UpdateRichUrlPolicySchema = z
  .object({ hosts: z.array(RichUrlHostRuleSchema).max(RICH_URL_POLICY_LIMITS.hostsMax) })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    val.hosts.forEach((h, i) => {
      if (seen.has(h.host)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '이미 목록에 있는 호스트입니다.', path: ['hosts', i, 'host'] });
      }
      seen.add(h.host);
    });
  });
export type UpdateRichUrlPolicyDto = z.infer<typeof UpdateRichUrlPolicySchema>;

export const RichUrlPolicyResponseSchema = z.object({
  chatbotId: z.string().uuid(),
  hosts: z.array(RichUrlHostRuleSchema),
  /** 행 없음 = `null`. */
  updatedAt: z.coerce.date().nullable(),
  /** 허용 목록 밖 주소를 쓰는 초안 노드 수(EX-RM-13). */
  outsideNodeCount: z.number().int().nonnegative(),
  /** 거버넌스 모드 + 빈 목록 = 콘솔 경고 배지(FR-RM6-5). */
  governanceModeOn: z.boolean(),
});
export type RichUrlPolicyResponse = z.infer<typeof RichUrlPolicyResponseSchema>;
