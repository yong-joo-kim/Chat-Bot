import { z } from 'zod';
import { parseBooleanString } from '@chat-bot/shared-types';

/**
 * boolean 환경변수 명시 파서. `z.coerce.boolean()`은 `Boolean("false") === true`라서 `=false`를
 * 명시해도 `true`가 된다(예: `TRUST_PROXY=false`가 `X-Forwarded-For`를 신뢰). 허용 값은
 * `true|false|1|0`(앞뒤 공백·대소문자 무시)이고, 미설정·빈 값은 기본값, 그 외 값은 기동 시 검증 실패다.
 * boolean 환경변수는 전부 이 헬퍼를 쓴다 — 규칙은 쿼리용 `queryBoolean()`과 같다(`parseBooleanString`).
 */
export function envBoolean(defaultValue: boolean) {
  return z.preprocess(parseBooleanString, z.boolean().default(defaultValue));
}

/**
 * 미설정을 구분해야 하는 boolean 환경변수용(예: `ENV_APPROVAL_OFF_LOCKED` — 미설정 / true / false 3상태).
 * 미설정·빈 값은 `undefined`로 남는다. `z.coerce.boolean()` 금지 규약은 같다.
 */
export function envBooleanOptional() {
  return z.preprocess(parseBooleanString, z.boolean().optional());
}
