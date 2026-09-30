import { validate } from './env.validation';

/** [신규 No.36] 가드레일·2인 승인 환경변수 5개 — 전부 선택(기본값 있음)이고 `envBoolean()`을 쓴다(ai-guardrails-설계.md §15). */
const base = { DATABASE_URL: 'file:./x.db', WIDGET_BASE_URL: 'http://localhost:5174', PUBLIC_API_BASE_URL: 'http://localhost:3000/api/v1' };

describe('env.validation — 가드레일 환경변수', () => {
  it('하나도 설정하지 않으면 기본값(켜짐 · 60초 · 50 · 2000 · 잠금 꺼짐)', () => {
    const env = validate({ ...base });
    expect(env).toMatchObject({
      GUARDRAILS_ENABLED: true,
      GUARDRAIL_CACHE_TTL_MS: 60000,
      GUARDRAIL_MAX_RULES_PER_CHATBOT: 50,
      GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT: 2000,
      ENV_APPROVAL_OFF_LOCKED: false,
    });
  });

  it('boolean은 "false"가 true가 되지 않는다(envBoolean)', () => {
    const off = validate({ ...base, GUARDRAILS_ENABLED: 'false', ENV_APPROVAL_OFF_LOCKED: 'true' });
    expect(off.GUARDRAILS_ENABLED).toBe(false);
    expect(off.ENV_APPROVAL_OFF_LOCKED).toBe(true);
  });

  it.each([
    ['GUARDRAIL_CACHE_TTL_MS', '999'],
    ['GUARDRAIL_CACHE_TTL_MS', '600001'],
    ['GUARDRAIL_MAX_RULES_PER_CHATBOT', '0'],
    ['GUARDRAIL_MAX_RULES_PER_CHATBOT', '201'],
    ['GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT', '99'],
    ['GUARDRAIL_MAX_EXPRESSIONS_PER_CHATBOT', '10001'],
  ])('범위를 벗어난 %s=%s는 기동 검증에서 거부한다', (key, value) => {
    expect(() => validate({ ...base, [key]: value })).toThrow();
  });
});
