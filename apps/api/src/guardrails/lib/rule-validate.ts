import { GUARDRAIL_LIMITS, normalizeText } from '@chat-bot/shared-types';
import type { BannedWordMatchType } from '@chat-bot/shared-types';

/**
 * 규칙 저장 검증 순수 함수(설계서 §4.2 ② ③) — DB·Nest 무의존.
 * zod(형식·길이·교차 조건)는 컨트롤러 파이프가 이미 처리했다. 여기서는 정규화 기준 검사를 한다.
 */

export type ExpressionIssueCode = 'TOO_SHORT' | 'EXACT_MULTI_TOKEN';

export interface ExpressionIssue {
  /** 입력 배열 기준 위치(`details[].field = expressions.<index>`). */
  index: number;
  code: ExpressionIssueCode;
  expression: string;
}

export interface PreparedExpressions {
  /** 원문(앞뒤 공백만 제거) — 정규화 기준 중복은 첫 등장만 유지한다. */
  expressions: string[];
  removedDuplicates: number;
  issues: ExpressionIssue[];
}

/** 정규화(`normalizeText`) 뒤 글자(코드 포인트) 수. */
function normalizedLength(normalized: string): number {
  return Array.from(normalized).length;
}

export function prepareExpressions(input: readonly string[], matchType: BannedWordMatchType): PreparedExpressions {
  const issues: ExpressionIssue[] = [];
  const seen = new Set<string>();
  const expressions: string[] = [];
  let removedDuplicates = 0;

  input.forEach((raw, index) => {
    const expression = raw.trim();
    const normalized = normalizeText(expression);
    if (normalizedLength(normalized) < GUARDRAIL_LIMITS.expressionMinNormalized) {
      issues.push({ index, code: 'TOO_SHORT', expression });
      return;
    }
    // `detect()`의 EXACT는 공백으로 자른 토큰 집합과 비교하므로 여러 단어 표현은 영원히 맞지 않는다(C-1).
    if (matchType === 'EXACT' && normalized.includes(' ')) {
      issues.push({ index, code: 'EXACT_MULTI_TOKEN', expression });
      return;
    }
    if (seen.has(normalized)) {
      removedDuplicates += 1;
      return;
    }
    seen.add(normalized);
    expressions.push(expression);
  });

  return { expressions, removedDuplicates, issues };
}

export type ReplacementIssueCode = 'NOT_PLAIN_TEXT' | 'TOO_MANY_LINES';

const TAG_LIKE = /<\/?[a-zA-Z!][^>\n]*>/;
const URL_LIKE = /(?:https?:\/\/|www\.|javascript:)/i;

/** 대체 문구는 글자만 — 태그 모양·URL·`javascript:` 포함 시 거부, 줄바꿈은 최대 5줄까지. */
export function checkReplacementText(text: string): ReplacementIssueCode | null {
  if (TAG_LIKE.test(text) || URL_LIKE.test(text)) return 'NOT_PLAIN_TEXT';
  if (text.split(/\r\n|\r|\n/).length > GUARDRAIL_LIMITS.replacementMaxLines) return 'TOO_MANY_LINES';
  return null;
}

export const EXPRESSION_ISSUE_MESSAGES: Record<ExpressionIssueCode, string> = {
  TOO_SHORT: '표현은 공백·대소문자를 정리한 뒤 2글자 이상이어야 합니다.',
  EXACT_MULTI_TOKEN: "'단어 일치'는 띄어쓰기 없는 한 단어 표현만 쓸 수 있습니다.",
};

export const REPLACEMENT_ISSUE_MESSAGES: Record<ReplacementIssueCode, string> = {
  NOT_PLAIN_TEXT: '대체 문구에는 링크나 HTML 태그를 쓸 수 없습니다. 글자만 적어 주세요.',
  TOO_MANY_LINES: `대체 문구는 최대 ${GUARDRAIL_LIMITS.replacementMaxLines}줄까지 적을 수 있습니다.`,
};

export interface RuleDetail {
  field: string;
  /** `<코드>: <설명>` — 콘솔은 앞의 코드 토큰으로 필드 오류를 분기한다(ui-spec §5.4). */
  message: string;
}

export interface ValidatedRuleBody {
  expressions: string[];
  removedDuplicates: number;
  /** `REPLACE`가 아니면 항상 `null`(입력돼도 버린다 — 설계서 §4.1). */
  replacementText: string | null;
}

export type RuleValidation = { ok: true; value: ValidatedRuleBody } | { ok: false; details: RuleDetail[] };

/** 저장 검증 ②(표현 정규화 기준) + ③(대체 문구 텍스트 검사) — 금지어 검사(④)·상한(⑤)은 서비스가 한다. */
export function validateRuleBody(body: {
  expressions: readonly string[];
  matchType: BannedWordMatchType;
  action: 'MONITOR' | 'REPLACE' | 'NO_RAG';
  replacementText?: string | null;
}): RuleValidation {
  const details: RuleDetail[] = [];
  const prepared = prepareExpressions(body.expressions, body.matchType);
  for (const issue of prepared.issues) {
    details.push({ field: `expressions.${issue.index}`, message: `${issue.code}: ${EXPRESSION_ISSUE_MESSAGES[issue.code]}` });
  }
  if (prepared.expressions.length === 0 && prepared.issues.length === 0) {
    details.push({ field: 'expressions', message: 'TOO_SHORT: 표현을 1개 이상 입력해 주세요.' });
  }

  let replacementText: string | null = null;
  if (body.action === 'REPLACE') {
    const text = (body.replacementText ?? '').trim();
    const issue = checkReplacementText(text);
    if (issue) details.push({ field: 'replacementText', message: `${issue}: ${REPLACEMENT_ISSUE_MESSAGES[issue]}` });
    else replacementText = text;
  }

  if (details.length > 0) return { ok: false, details };
  return { ok: true, value: { expressions: prepared.expressions, removedDuplicates: prepared.removedDuplicates, replacementText } };
}
