/**
 * [코드리뷰 1회차 Low] UUID 형식 검증(순수 함수) — `x-cb-session-id` 헤더는 zod 파이프를 타지
 * 않는(`@Headers()`로 직접 읽는) 값이라 별도로 검증한다. `PublicMessageRequestSchema.sessionId`
 * (본문)는 이미 `z.string().uuid()`로 검증되므로 이 함수를 쓰지 않는다.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
