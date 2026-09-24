/**
 * [No.26 레거시 API 연동] 응답 경로 추출 · 조건 판정 · 텍스트 치환 순수 함수.
 * `docs/02-spec/legacy-api-integration-설계.md` §4.5 근거. **zod 무의존** — 엔진(`dialogue-engine`)과
 * `apps/web` 편집기 미리보기·시뮬레이터가 같은 1벌을 쓴다(웹은 `shared-types`만 의존).
 * 이 파일은 어떤 도메인 스키마(`dialogue.ts` 등)도 import하지 않는다(순환 금지).
 */

/* ------------------------------------------------------------------------------------------------
 * 응답 경로 문법 — parseResponsePath / extractPath
 * ---------------------------------------------------------------------------------------------- */

export type ApiPathSegment = { kind: 'KEY'; key: string } | { kind: 'INDEX'; index: number };

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 키 = `/^[^.\[\]\s"'`\\]{1,64}$/u`(설계 §4.5). */
const PATH_KEY_RE = /^[^.[\]\s"'`\\]{1,64}$/u;
const PATH_INDEX_RE = /^\[(\d{1,4})\]/;

/**
 * 문법 = `토큰(.토큰)*`, 토큰 = `키([정수])*` 또는 선두 `[정수]`. 와일드카드·필터식·재귀 하강·
 * 슬라이스·스크립트를 지원하지 않는다. 토큰 수(점으로 구분한 개수) ≤10. 위반이면 `null`.
 */
export function parseResponsePath(path: string): ApiPathSegment[] | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return null;
  const rawTokens = path.split('.');
  if (rawTokens.length === 0 || rawTokens.length > 10) return null;

  const segments: ApiPathSegment[] = [];
  for (const rawToken of rawTokens) {
    if (rawToken.length === 0) return null;

    let rest = rawToken;
    let keyPart = '';
    const bracketIdx = rest.indexOf('[');
    if (bracketIdx === -1) {
      keyPart = rest;
      rest = '';
    } else {
      keyPart = rest.slice(0, bracketIdx);
      rest = rest.slice(bracketIdx);
    }

    if (keyPart.length > 0) {
      if (!PATH_KEY_RE.test(keyPart)) return null;
      if (FORBIDDEN_PATH_KEYS.has(keyPart)) return null;
      segments.push({ kind: 'KEY', key: keyPart });
    } else if (rest.length === 0) {
      return null;
    }

    while (rest.length > 0) {
      const match = PATH_INDEX_RE.exec(rest);
      if (!match) return null;
      const n = Number(match[1]);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
      segments.push({ kind: 'INDEX', index: n });
      rest = rest.slice(match[0].length);
    }
  }

  if (segments.length === 0) return null;
  return segments;
}

export interface ApiExtractResult {
  found: boolean;
  value?: unknown;
}

/** 파싱 결과를 따라가며 자기 속성만 읽는다(프로토타입 오염 방지). */
export function extractPath(json: unknown, path: string): ApiExtractResult {
  const segments = parseResponsePath(path);
  if (!segments) return { found: false };

  let cur: unknown = json;
  for (const seg of segments) {
    if (seg.kind === 'KEY') {
      if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return { found: false };
      if (!Object.prototype.hasOwnProperty.call(cur, seg.key)) return { found: false };
      cur = (cur as Record<string, unknown>)[seg.key];
    } else {
      if (!Array.isArray(cur)) return { found: false };
      if (seg.index < 0 || seg.index >= cur.length) return { found: false };
      cur = cur[seg.index];
    }
  }
  return { found: true, value: cur };
}

/** 문자열 그대로 · 유한 숫자 `String()` · 불리언 `'true'|'false'` · 그 외(null/객체/배열)는 `undefined`. */
export function toComparable(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return undefined;
}

/* ------------------------------------------------------------------------------------------------
 * 조건 판정 — evaluateApiConditions
 * ---------------------------------------------------------------------------------------------- */

export type ApiConditionOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'CONTAINS' | 'EXISTS';

export interface ApiConditionForEval {
  path: string;
  operator: ApiConditionOperator;
  value?: string;
}

const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function evalOneCondition(extracted: ApiExtractResult, operator: ApiConditionOperator, cmpValue: string): boolean {
  switch (operator) {
    case 'EQ': {
      const comparable = extracted.found ? toComparable(extracted.value) : undefined;
      return comparable !== undefined && comparable === cmpValue;
    }
    case 'NEQ': {
      const comparable = extracted.found ? toComparable(extracted.value) : undefined;
      return comparable === undefined || comparable !== cmpValue;
    }
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      const comparable = extracted.found ? toComparable(extracted.value) : undefined;
      if (comparable === undefined || !NUMERIC_RE.test(comparable) || !NUMERIC_RE.test(cmpValue)) return false;
      const a = Number(comparable);
      const b = Number(cmpValue);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (operator === 'GT') return a > b;
      if (operator === 'GTE') return a >= b;
      if (operator === 'LT') return a < b;
      return a <= b;
    }
    case 'CONTAINS': {
      if (!extracted.found) return false;
      if (Array.isArray(extracted.value)) {
        return extracted.value.some((item) => toComparable(item) === cmpValue);
      }
      const comparable = toComparable(extracted.value);
      return comparable !== undefined && comparable.includes(cmpValue);
    }
    case 'EXISTS':
      return extracted.found && extracted.value !== null && extracted.value !== undefined;
    default:
      return false;
  }
}

/** 위에서부터 첫 일치의 인덱스(0부터) 또는 `null`(불일치). 조건 `value` 미지정은 `""`으로 취급한다. */
export function evaluateApiConditions(json: unknown, conditions: readonly ApiConditionForEval[]): number | null {
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    const extracted = extractPath(json, c.path);
    if (evalOneCondition(extracted, c.operator, c.value ?? '')) return i;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * 응답 매핑 — buildApiVariables / normalizeApiValue
 * ---------------------------------------------------------------------------------------------- */

export interface ApiResponseMappingForBuild {
  name: string;
  path: string;
  required: boolean;
  maxLength: number;
}

export interface ApiVariableBuildResult {
  vars: Record<string, string>;
  missingRequired: string[];
  dropped: string[];
}

/** 제어·서식(zero-width·bidi·BOM) 문자 제거 대상 범위. */
const CONTROL_FORMAT_RE = new RegExp('[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]', 'g');

/** 문자열화 → 제어·서식 문자 제거 → 코드 포인트 기준 `maxLength` 절단. */
export function normalizeApiValue(v: unknown, maxLength: number): string {
  const s = typeof v === 'string' ? v : (toComparable(v) ?? '');
  const cleaned = s.replace(CONTROL_FORMAT_RE, '');
  const chars = Array.from(cleaned);
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : cleaned;
}

/**
 * 스칼라는 `normalizeApiValue()`, 객체·배열은 `""` + `dropped`(비스칼라),
 * 없음/`null`은 `required`면 `missingRequired`.
 */
export function buildApiVariables(json: unknown, mappings: readonly ApiResponseMappingForBuild[]): ApiVariableBuildResult {
  const vars: Record<string, string> = {};
  const missingRequired: string[] = [];
  const dropped: string[] = [];

  for (const m of mappings) {
    const extracted = extractPath(json, m.path);
    if (!extracted.found || extracted.value === null || extracted.value === undefined) {
      if (m.required) missingRequired.push(m.name);
      continue;
    }
    if (typeof extracted.value === 'object') {
      vars[m.name] = '';
      dropped.push(m.name);
      continue;
    }
    vars[m.name] = normalizeApiValue(extracted.value, m.maxLength);
  }

  return { vars, missingRequired, dropped };
}

/* ------------------------------------------------------------------------------------------------
 * 텍스트 치환 — renderApiTokens
 * ---------------------------------------------------------------------------------------------- */

const API_TOKEN_RE = /\{api\.([a-zA-Z][a-zA-Z0-9_]{0,29})\}/g;

/**
 * `{api.이름}`만 치환한다(없는 이름은 `""`). 그 외 `{...}`는 문자 그대로 유지한다(AC-L3-8).
 * 컨텍스트 완료 메시지의 `{슬롯}` 치환(`context-session.ts`)과는 다른 함수이며 서로 호출하지 않는다.
 */
export function renderApiTokens(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(API_TOKEN_RE, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : '',
  );
}
