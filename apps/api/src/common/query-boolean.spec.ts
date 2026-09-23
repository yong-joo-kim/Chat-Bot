import {
  BannedWordListQuerySchema,
  ChatbotListQuerySchema,
  DialogNodeListQuerySchema,
  TestCaseListQuerySchema,
} from '@chat-bot/shared-types';

/**
 * 목록 쿼리 boolean 파싱 회귀 — `z.coerce.boolean()`은 `?enabled=false`를 `true`로 만들어
 * "비활성만" 필터가 활성 항목을 돌려주던 결함이 있었다(`queryBoolean()`으로 교체).
 */
describe('shared-types queryBoolean — 목록 쿼리 boolean 파싱', () => {
  it('enabled=false는 false, enabled=true는 true, 미지정·빈 값은 undefined다', () => {
    for (const schema of [DialogNodeListQuerySchema, TestCaseListQuerySchema, BannedWordListQuerySchema]) {
      expect(schema.parse({ enabled: 'false' }).enabled).toBe(false);
      expect(schema.parse({ enabled: '0' }).enabled).toBe(false);
      expect(schema.parse({ enabled: 'true' }).enabled).toBe(true);
      expect(schema.parse({}).enabled).toBeUndefined();
      expect(schema.parse({ enabled: '' }).enabled).toBeUndefined();
    }
  });

  it('기본값이 있는 필드는 미지정 시 기본값, "false"면 false다', () => {
    expect(ChatbotListQuerySchema.parse({}).includeArchived).toBe(false);
    expect(ChatbotListQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ChatbotListQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
  });

  it('허용되지 않은 값은 검증 실패다(조용히 true로 바뀌지 않는다)', () => {
    expect(DialogNodeListQuerySchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});
