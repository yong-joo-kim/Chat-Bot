import { z } from 'zod';

/**
 * 부팅 시 필수 환경변수를 검증한다(NFR-M1, EX-4-3).
 * 배포형태(구축형/구독형) 중립을 위해 위젯/공개 API base URL은 반드시 환경변수로만 주입하며,
 * 누락 시 런타임 500이 아니라 기동 실패로 즉시 드러나야 한다.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL이 설정되지 않았습니다.'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WIDGET_BASE_URL: z
    .string()
    .min(1, 'WIDGET_BASE_URL이 설정되지 않았습니다.')
    .refine((v) => /^https?:\/\//i.test(v), 'WIDGET_BASE_URL은 http 또는 https로 시작해야 합니다.'),
  PUBLIC_API_BASE_URL: z
    .string()
    .min(1, 'PUBLIC_API_BASE_URL이 설정되지 않았습니다.')
    .refine((v) => /^https?:\/\//i.test(v), 'PUBLIC_API_BASE_URL은 http 또는 https로 시작해야 합니다.'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`환경변수 검증 실패:\n${issues}`);
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }
  return result.data;
}
