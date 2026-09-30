import {
  CreateGuardrailRuleSchema,
  CreateProdSwitchApprovalSchema,
  GUARDRAIL_ACTION_LABELS,
  GUARDRAIL_CATEGORY_LABELS,
  GuardrailCategory,
  GuardrailEventListQuerySchema,
  UpdateApprovalPolicySchema,
} from '@chat-bot/shared-types';

const valid = { name: '위기 안내', category: 'CRISIS_SELF_HARM', expressions: ['자살', '죽고 싶다'], appliesTo: 'INBOUND' } as const;

describe('shared-types 가드레일 계약(설계서 §13.2)', () => {
  it('새 규칙의 기본 동작은 기록만(MONITOR) · 매칭 방식 CONTAINS · 켜짐(AC-AG2-2)', () => {
    const parsed = CreateGuardrailRuleSchema.parse(valid);
    expect(parsed.action).toBe('MONITOR');
    expect(parsed.matchType).toBe('CONTAINS');
    expect(parsed.enabled).toBe(true);
  });

  it('REPLACE는 대체 문구가 필수', () => {
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'REPLACE' }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'REPLACE', replacementText: '안전 문구' }).success).toBe(true);
  });

  it('NO_RAG는 적용 위치가 INBOUND일 때만(BOTH·OUTBOUND 거부 — AC-AG2-4)', () => {
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'NO_RAG' }).success).toBe(true);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'NO_RAG', appliesTo: 'BOTH' }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'NO_RAG', appliesTo: 'OUTBOUND' }).success).toBe(false);
  });

  it('길이 상한 — 이름 50 · 표현 50 · 표현 100개 · 대체 문구 300', () => {
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, name: '가'.repeat(51) }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, expressions: ['가'.repeat(51)] }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, expressions: Array.from({ length: 101 }, (_, i) => `표현${i}`) }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, action: 'REPLACE', replacementText: '가'.repeat(301) }).success).toBe(false);
    expect(CreateGuardrailRuleSchema.safeParse({ ...valid, expressions: [] }).success).toBe(false);
  });

  it('적용 위치는 필수(기본값 없음)', () => {
    const { appliesTo: _drop, ...rest } = valid;
    expect(CreateGuardrailRuleSchema.safeParse(rest).success).toBe(false);
  });

  it('분류 8종과 라벨', () => {
    expect(GuardrailCategory.options).toHaveLength(8);
    expect(Object.keys(GUARDRAIL_CATEGORY_LABELS)).toHaveLength(8);
    expect(GUARDRAIL_ACTION_LABELS).toEqual({ MONITOR: '기록만', REPLACE: '안전 문구로 대체', NO_RAG: 'AI로 보내지 않음' });
  });

  it('이벤트 목록 쿼리 — 기간 필수 · 페이지 기본 50 · 최대 100', () => {
    const ok = GuardrailEventListQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30' });
    expect(ok.pageSize).toBe(50);
    expect(GuardrailEventListQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30', pageSize: 101 }).success).toBe(false);
    expect(GuardrailEventListQuerySchema.safeParse({ to: '2026-09-30' }).success).toBe(false);
  });

  it('승인 정책 — 만료 시간 1~168시간', () => {
    expect(UpdateApprovalPolicySchema.safeParse({ required: true, ttlHours: 24 }).success).toBe(true);
    expect(UpdateApprovalPolicySchema.safeParse({ required: true, ttlHours: 0 }).success).toBe(false);
    expect(UpdateApprovalPolicySchema.safeParse({ required: true, ttlHours: 169 }).success).toBe(false);
  });

  it('승인 요청은 action 판별 유니온', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(CreateProdSwitchApprovalSchema.safeParse({ action: 'PROD_SWITCH', targetVersionId: id, expectedProdVersionId: id }).success).toBe(true);
    expect(CreateProdSwitchApprovalSchema.safeParse({ action: 'PROD_ROLLBACK', expectedProdVersionId: id }).success).toBe(true);
    expect(CreateProdSwitchApprovalSchema.safeParse({ action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: id }).success).toBe(true);
    expect(CreateProdSwitchApprovalSchema.safeParse({ action: 'PROD_SWITCH', expectedProdVersionId: id }).success).toBe(false);
  });
});
