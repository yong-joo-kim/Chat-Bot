import { GUARDRAIL_LIMITS, GuardrailRuleBodySchema, normalizeText } from '@chat-bot/shared-types';
import type { BannedWordMatchType, GuardrailAction, GuardrailAppliesTo, GuardrailCategory, GuardrailRule, GuardrailRuleBody } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { MESSAGES } from '../../../constants/messages';

/** 규칙 폼 값(적용 위치·분류는 사전 선택 없음 — 빈 문자열이 "미선택", UIUX §6). */
export interface RuleFormValues {
  name: string;
  category: GuardrailCategory | '';
  appliesTo: GuardrailAppliesTo | '';
  action: GuardrailAction;
  expressions: string[];
  matchType: BannedWordMatchType;
  replacementText: string;
  enabled: boolean;
}

export const EMPTY_RULE_FORM: RuleFormValues = {
  name: '',
  category: '',
  appliesTo: '',
  // PM 확정 — 새 규칙 기본 동작은 "기록만"(안전한 관찰 우선).
  action: 'MONITOR',
  expressions: [],
  matchType: 'CONTAINS',
  replacementText: '',
  enabled: true,
};

export function ruleToFormValues(rule: GuardrailRule): RuleFormValues {
  return {
    name: rule.name,
    category: rule.category,
    appliesTo: rule.appliesTo,
    action: rule.action,
    expressions: [...rule.expressions],
    matchType: rule.matchType,
    replacementText: rule.replacementText ?? '',
    enabled: rule.enabled,
  };
}

export interface RuleFormErrors {
  name?: string;
  category?: string;
  appliesTo?: string;
  action?: string;
  expressions?: string;
  replacementText?: string;
  /** 폼 상단 배너(필드에 붙지 않는 오류). */
  form?: string;
}

/** 서버 검증에서 걸린 표현(칩 강조용 — 제출한 값 기준). */
export interface RuleFormServerResult {
  errors: RuleFormErrors;
  invalidExpressions: string[];
  /** 404 — 다른 관리자가 삭제한 규칙. */
  notFound?: boolean;
}

const TAG_LIKE = /<\/?[a-zA-Z!][^>\n]*>/;
const URL_LIKE = /(?:https?:\/\/|www\.|javascript:)/i;

/** 정규화(공백·대소문자 정리) 뒤 글자 수. */
export function normalizedLength(v: string): number {
  return Array.from(normalizeText(v)).length;
}

/** 표현 1개의 추가 직전 검증(칩 입력기 안에서 즉시 표시) — 문구를 돌려주면 추가를 막는다. */
export function validateExpressionOnAdd(value: string): string | undefined {
  const m = MESSAGES.guardrails.form;
  if (Array.from(value).length > GUARDRAIL_LIMITS.expressionMax) return m.expressionTooLong(GUARDRAIL_LIMITS.expressionMax);
  if (normalizedLength(value) < GUARDRAIL_LIMITS.expressionMinNormalized) return m.expressionTooShort(value);
  return undefined;
}

/** 제출 전 사전 검사(서버를 부르지 않는다, UIUX §7). */
export function validateRuleForm(v: RuleFormValues): { errors: RuleFormErrors; invalidExpressions: string[] } {
  const m = MESSAGES.guardrails.form.errors;
  const fm = MESSAGES.guardrails.form;
  const errors: RuleFormErrors = {};
  let invalidExpressions: string[] = [];
  const name = v.name.trim();
  if (!name || Array.from(name).length > GUARDRAIL_LIMITS.nameMax) errors.name = m.nameRequired;
  if (!v.category) errors.category = m.categoryRequired;
  if (!v.appliesTo) errors.appliesTo = m.appliesToRequired;
  if (v.action === 'NO_RAG' && v.appliesTo !== 'INBOUND') errors.action = m.noRagOnlyInbound;
  if (v.expressions.length === 0) {
    errors.expressions = m.expressionsRequired;
  } else if (v.matchType === 'EXACT') {
    const multi = v.expressions.filter((e) => normalizeText(e).includes(' '));
    if (multi.length > 0) {
      errors.expressions = fm.expressionExactMulti(multi[0]);
      invalidExpressions = multi;
    }
  }
  if (v.action === 'REPLACE') {
    const text = v.replacementText.trim();
    if (!text) errors.replacementText = m.replacementRequired;
    else if (TAG_LIKE.test(text) || URL_LIKE.test(text)) errors.replacementText = m.replacementNotPlain;
    else if (text.split(/\r\n|\r|\n/).length > GUARDRAIL_LIMITS.replacementMaxLines) errors.replacementText = m.replacementLines;
  }
  return { errors, invalidExpressions };
}

/** 폼 값 → 저장·시험 본문. 필수 항목이 비어 완성되지 않았으면 null(저장 전 시험 불가). */
export function buildRuleBody(v: RuleFormValues): GuardrailRuleBody | null {
  const parsed = GuardrailRuleBodySchema.safeParse({
    name: v.name,
    category: v.category || undefined,
    expressions: v.expressions,
    matchType: v.matchType,
    appliesTo: v.appliesTo || undefined,
    action: v.action,
    replacementText: v.action === 'REPLACE' ? v.replacementText : null,
    enabled: v.enabled,
  });
  return parsed.success ? parsed.data : null;
}

/** 서버 오류 → 필드 오류(ui-spec §5.4 표). `details[].message`의 앞 코드 토큰으로 분기한다. */
export function mapRuleServerError(e: unknown, submittedExpressions: string[]): RuleFormServerResult {
  const m = MESSAGES.guardrails.form;
  const errors: RuleFormErrors = {};
  const invalidExpressions: string[] = [];
  if (!(e instanceof ApiError)) return { errors: { form: m.errors.generic }, invalidExpressions };

  if (e.code === 'VALIDATION_FAILED') {
    for (const d of e.details ?? []) {
      const code = d.message.split(':')[0]?.trim();
      const field = d.field ?? '';
      if (field.startsWith('expressions')) {
        const index = Number(field.split('.')[1]);
        const value = Number.isInteger(index) ? submittedExpressions[index] : undefined;
        if (value !== undefined) invalidExpressions.push(value);
        if (code === 'EXACT_MULTI_TOKEN') errors.expressions = m.expressionExactMulti(value ?? '');
        else if (code === 'TOO_SHORT' && value !== undefined) errors.expressions = m.expressionTooShort(value);
        else errors.expressions = errors.expressions ?? (code === 'TOO_SHORT' ? m.errors.expressionsRequired : d.message);
      } else if (field === 'replacementText') {
        if (code === 'NOT_PLAIN_TEXT') errors.replacementText = m.errors.replacementNotPlain;
        else if (code === 'TOO_MANY_LINES') errors.replacementText = m.errors.replacementLines;
        else errors.replacementText = m.errors.replacementRequired;
      } else if (field === 'action') {
        errors.action = m.errors.noRagOnlyInbound;
      } else if (field === 'name') {
        errors.name = m.errors.nameRequired;
      } else if (field === 'category') {
        errors.category = m.errors.categoryRequired;
      } else if (field === 'appliesTo') {
        errors.appliesTo = m.errors.appliesToRequired;
      } else {
        errors.form = errors.form ?? m.errors.generic;
      }
    }
    if (Object.keys(errors).length === 0) errors.form = m.errors.generic;
    return { errors, invalidExpressions };
  }
  if (e.code === 'BANNED_WORD_BLOCKED') {
    const words = e.details?.[0]?.message ?? '';
    return { errors: { replacementText: m.errors.bannedWordBlocked(words) }, invalidExpressions };
  }
  if (e.code === 'DUPLICATE_NAME') return { errors: { name: m.errors.duplicateName }, invalidExpressions };
  if (e.code === 'LIMIT_EXCEEDED') return { errors: { form: m.errors.limitExceeded }, invalidExpressions };
  if (e.code === 'CHATBOT_ARCHIVED') return { errors: { form: m.errors.archived }, invalidExpressions };
  if (e.code === 'NOT_FOUND' || e.status === 404) return { errors: { form: m.errors.notFound }, invalidExpressions, notFound: true };
  return { errors: { form: m.errors.generic }, invalidExpressions };
}
